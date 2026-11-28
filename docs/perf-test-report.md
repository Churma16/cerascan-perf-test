# CeraScan Performance Test Report (Baseline vs Production Architecture)

- **Service**: CeraScan API Gateway (`vgg-backend-express` + `backend-python`)
- **Environment**: Local Benchmark (`http://localhost:3000`, `BENCH_PROFILE=local`)
- **Date**: 2026-11-28
- **Tooling**: Grafana k6 (`cerascan-perf-test`)

---

## 1. Objectives
Memvalidasi secara empiris 8 keputusan arsitektur CeraScan (RabbitMQ, Redis, SSE, gRPC, Cloudflare R2, CQRS/Polyglot DB, DLQ, dan Batch Ingestion) terhadap implementasi *baseline* tradisional/naif pada mesin, database, dan beban trafik yang sama (*apple-to-apple comparison*).

---

## 2. Environment & Service Configuration
| Component | Configuration / Port |
| :--- | :--- |
| **Express API Gateway** | Node.js (dev), port `3000`, Sequelize MySQL Pool (`max: 20`), `ENABLE_BASELINE_ROUTES=true` |
| **Python ML (gRPC)** | `grpc_server.py`, port `50051`, HTTP/2 Protobuf, `max_workers=10`, deadline `10s` |
| **Python ML (REST)** | `app.py` (FastAPI), port `8000`, HTTP/1.1 Multipart, timeout `10s` |
| **Message Broker** | RabbitMQ `3-management-alpine` (Docker), port `5672`, `prefetchCount=1` |
| **Datastores** | MySQL 8.0 (`3306`), Redis (`6379`), MongoDB (`27017`), Cloudflare R2 (S3 API) |

---

## 3. Test Rundown & Expectations
- **Pass Criteria**:
  - `http_req_failed`: `< 5%` (upload/ML) dan `< 2%` (read/cache).
  - Baseline vs Production dibandingkan langsung per metrik secara berdampingan (*side-by-side*): **RPS**, **Avg**, **P95**, **P99**, dan **Error Rate**.

---

## 4. Performance Comparison (Baseline vs Production)

| Case | Skenario Komparasi (Production vs Baseline) | k6 Target RPS / Load | Base RPS | Prod RPS | Base Avg | Prod Avg | Base P95 | Prod P95 | Base P99 | Prod P99 | Base Err % | Prod Err % | Delta | Kesimpulan |
| :-: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- |
| **01** | **RabbitMQ Async Queue** vs **Direct Sync** (Normal) | `20 VUs` (40s, ramping-vus) | `6.99/s` | `8.25/s` | `622.43ms` | `354.09ms` | `1.23s` | `558.47ms` | `1.43s` | `1.05s` | `0.00%` | `0.00%` | P95 `-54.6%` (2.2x), RPS `+19.6%` | RabbitMQ menyerap beban upload tanpa menahan socket, meski `arch:01` ikut mengunggah ke R2. |
| **01b** | **RabbitMQ Async Queue** vs **Direct Sync** (High-Spike) | `30 RPS` (constant-arrival-rate, 25s) | `7.76/s` (500 dropped) | `29.39/s` (0 dropped) | `6.37s` | `343.67ms` | `8.35s` | `484.56ms` | `8.74s` | `755.29ms` | `0.00%` | `0.00%` | P95 `-94.2%` (17.2x), P99 `-91.4%` (11.6x), RPS `+278.7%` | Direct Sync mencapai batas kapasitas alokasi VUs (60 VUs) dan mengalami 500 dropped iterations; RabbitMQ memproses 30 RPS tanpa dropped request dengan utilisasi 9-16 VUs. |
| **01b-mid** | **RabbitMQ Durable Broker** vs **In-Process RAM Queue** (High-Spike) | `30 RPS` (constant-arrival-rate, 25s) | `29.96/s` (0 dropped) | `29.39/s` (0 dropped) | `1.99ms` | `343.67ms`* | `4.02ms` | `484.56ms`* | `6.12ms` | `755.29ms`* | `0.00%` | `0.00%` | In-Process 202 lebih cepat di HTTP latency murni | Trade-off: In-Process Queue menyimpan buffer gambar di memori heap V8 (100% data loss saat crash); RabbitMQ memberikan durabilitas disk dan worker decoupling. *(Catatan: Latensi 343ms pada prod mencakup upload R2; overhead publish RabbitMQ murni hanya ~3ms).* |
| **02** | **Redis Cache** vs **Direct MySQL Query** (Normal) | `80 VUs` (~43 RPS, sleep 1s) | `43.65/s` | `43.48/s` | `5.79ms` | `7.60ms` | `10.41ms` | `12.08ms` | `14.79ms` | `21.46ms` | `0.00%` | `0.00%` | RPS `-0.4%`, P95 `+1.67ms` | Pada beban ringan (~43 RPS) dengan ukuran data kecil di buffer pool, perbedaan latensi Redis dan DB berada dalam rentang toleransi jaringan. |
| **02b** | **Redis Cache** vs **Direct MySQL Query** (High-RPS) | `60 VUs` (Max RPS, no sleep) | `272.28/s` | `461.43/s` | `122.93ms` | `72.37ms` | `211.65ms` | `134.46ms` | `257.25ms` | `175.48ms` | `0.00%` | `0.00%` | RPS `+69.5%`, P95 `-36.5%`, P99 `-31.8%` | Pada beban tinggi tanpa jeda sleep, Redis mempertahankan latensi stabil di bawah threshold (P95 134.46ms), sedangkan kueri langsung ke DB terdegradasi melebihi threshold (P95 211.65ms). |
| **02b-mid** | **Redis Distributed Cache** vs **In-Process RAM Cache** (High-RPS) | `60 VUs` (Max RPS, no sleep) | `2344.19/s` | `461.43/s` | `14.08ms` | `72.37ms` | `34.28ms` | `134.46ms` | `47.52ms` | `175.48ms` | `0.00%` | `0.00%` | In-Process Cache 5x lebih cepat di single node | Membuktikan prinsip arsitektur: In-Process Cache unggul di 1 mesin, namun Redis diperlukan untuk skalabilitas multi-instance dan konsistensi cache bersama. |
| **03** | **SSE Persistent Stream** vs **HTTP Short Polling** | `100 Concurrent VUs` (1m40s) | `29.38/s` | `3.70/s` | `6.55ms` | `15s` hold | `10.12ms` | `15s` hold | `13.13ms` | `15s` hold | `0.00%` | `0.00%` | Reqs `-87.4%` (7.9x), Bandwidth `-92.9%` | SSE mengeliminasi 3.339 kueri polling DB berkala dan mengurangi penggunaan bandwidth sebesar 92.9% (213 kB vs 3.0 MB). |
| **04** | **gRPC (HTTP/2 Protobuf)** vs **REST FastAPI (HTTP/1.1 Multipart)** | `8 RPS` (constant-arrival-rate, 30s) | `6.21/s` (31 dropped) | `7.92/s` (0 dropped) | `3.25s` | `398.38ms` | `5.10s` | `554.77ms` | `5.56s` | `594.95ms` | `0.00%` | `0.00%` | P95 `-89.1%` (9.2x), P99 `-89.3%`, Dropped `0` vs `31` | Bahkan saat REST diberi 10 worker threads dan HTTP Keep-Alive, gRPC HTTP/2 Protobuf tetap 9.2x lebih cepat di P95 tanpa request yang dropped. |
| **05** | **Cloudflare R2 Storage** vs **Local Disk Server (/uploads)** | `10 iter/s` (constant-arrival-rate, 30s) | `9.97/s` | `9.89/s` | `12.69ms` (upload) | `401.34ms` (upload) | `34.34ms` (upload) | `644.47ms` (upload) | `100.26ms` (upload) | `870.26ms` (upload) | `0.00%` | `0.00%` | Disk lokal `0 MB` vs `~190 MB`, Outbound `-99.8%` | Penulisan ke SSD lokal berkinerja lebih cepat, namun penyimpanan R2 menjamin backend tetap sepenuhnya stateless dan mengalihkan 99.8% beban transfer keluar. |
| **06** | **CQRS Polyglot (Mongo/Redis)** vs **Monolith MySQL Scan** (Normal) | `40 Read + 5 Write RPS` (30s) | `44.42/s` | `44.55/s` | `9.10ms` (R) / `369ms` (W) | `8.00ms` (R) / `364ms` (W) | `14.20ms` (R) / `561ms` (W) | `13.11ms` (R) / `508ms` (W) | `18.66ms` (R) / `687ms` (W) | `17.52ms` (R) / `638ms` (W) | `0.00%` | `0.00%` | Read/Write stabil | Pada beban normal (~45 RPS), performa MySQL dan CQRS sebanding karena kapasitas buffer pool masih memadai. |
| **06b** | **CQRS Polyglot (Mongo/Redis)** vs **Monolith MySQL Scan** (High-RPS) | `250 Read + 15 Write RPS` (30s) | `169.08/s` | `259.81/s` | `626ms` (R) / `1025ms` (W) | `51.1ms` (R) / `377ms` (W) | `810ms` (R) / `1238ms` (W) | `155ms` (R) / `544ms` (W) | `850ms` (R) / `1336ms` (W) | `219ms` (R) / `739ms` (W) | `0.00%` | `0.00%` | Read Avg `-91.8%` (12.3x), Write Avg `-63.2%` (2.7x), Dropped `25` vs `2777` | Pada arsitektur Monolith, beban kueri baca agregasi memperlambat transaksi tulis hingga >1s; CQRS mengisolasi jalur baca dan tulis secara terpisah. |
| **06b-mid** | **CQRS Polyglot (Mongo/Redis)** vs **MySQL Indexed Summary Query** | `250 Read + 15 Write RPS` (30s) | `230.99/s` *(pool 60)* / `169.80/s` *(pool 20)* | `259.81/s` | `316.2ms` (R) / `473.5ms` (W) | `51.1ms` (R) / `377ms` (W) | `680.7ms` (R) / `903.9ms` (W) | `155ms` (R) / `544ms` (W) | `824.8ms` (R) / `1345ms` (W) | `219ms` (R) / `739ms` (W) | `0.00%` | `0.00%` | CQRS Read 4.4x–5.5x lebih cepat, Dropped `25` vs `930` (pool 60) & `2701` (pool 20) | Uji sensitivitas pool: memperbesar pool koneksi dari 20 ke 60 menurunkan dropped iterations dari 2.701 ke 930, namun latensi baca P95 tetap 680ms (4.4x lebih lambat dari CQRS 155ms), membuktikan batas saturasi ada pada engine database tunggal. |
| **07** | **RabbitMQ DLQ** vs **Fail-and-Forget (Instant 500)** | `20 shared-iterations` (5 VUs) | `4.88/s` | `4.85/s` | `4.68ms` | `10.85ms` | `3.99ms` | `21.93ms` | `56.78ms` | `60.76ms` | `95.23%` (100% loss) | `0.00%` | Data loss `0%` vs `100%` | `base:07` langsung melempar HTTP 500 (20/20 request hilang); `arch:07` menjamin 0% data loss & retryability. |
| **07b-mid** | **RabbitMQ DLQ** vs **In-Process 3x Retry + Backoff** | `20 shared-iterations` (5 VUs) | `4.85/s` | `4.85/s` | `56.52ms` | `10.85ms` | `60.96ms` | `21.93ms` | `80.40ms` | `60.76ms` | `0.00%` | `0.00%` | Avg `-80.8%` (5.2x lebih cepat), P95 `-64.0%` | In-process synchronous retry berhasil memulihkan kegagalan transient (0% error), namun menahan socket klien 5.2x lebih lama (Avg 56.5ms vs 10.8ms); RabbitMQ memindahkan retry ke background worker secara asinkron. |
| **08** | **Batch Multipart (1 Request)** vs **Single Loop (10 Requests)** | `2 batch/s` (10 img/batch, 30s) | `1.26 req/s` *(1.26 img/s)* | `0.50 batch/s` *(5.00 img/s)* | `9.12s` | `5.46s` | `14.82s` | `8.32s` | `16.50s` | `8.75s` | `0.00%` | `0.00%` | Throughput Gambar `+296.8%` (4.0x), P95 `-43.9%`, Reqs `-93.8%` | Batch upload memproses 5.0 gambar/detik vs 1.26 gambar/detik pada looping (4x throughput gambar), memangkas latency P95/P99 hampir separuh dan menghemat 93.8% jumlah request HTTP. |
| **09** | **Redis Write-Behind** vs **MySQL Row-Lock (FOR UPDATE)** | `60 VUs` (Hot-User Burst, 20s, no sleep) | `127.45/s` | `4288.53/s` | `463.70ms` | `13.84ms` | `617.83ms` | `23.45ms` | `727.87ms` | `36.86ms` | `0.00%` | `0.00%` | RPS `+3265%` (33.6x), P95 `-96.2%` (26.3x), P99 `-94.9%` (19.7x) | Transaksi multi-langkah dengan SELECT ... FOR UPDATE terhambat di 127.45 RPS akibat saturasi lock contention pada baris yang sama. |
| **09b** | **Redis Write-Behind** vs **MySQL Atomic Single SQL** | `60 VUs` (Hot-User Burst, 20s, no sleep) | `784.49/s` | `4288.53/s` | `76.10ms` | `13.84ms` | `100.73ms` | `23.45ms` | `127.61ms` | `36.86ms` | `0.00%` | `0.00%` | RPS `+446.7%` (5.5x), P95 `-76.7%` (4.3x), P99 `-71.1%` | Baseline SQL realistis (`UPDATE ... WHERE quota > 0`) mencapai 784 RPS, namun Redis Write-Behind tetap 5.5x lebih unggul. |
| **09c** | **Redis Write-Behind** vs **Redis Sync Write-Through** | `60 VUs` (Hot-User Burst, 20s, no sleep) | `701.58/s` | `4288.53/s` | `85.16ms` | `13.84ms` | `125.64ms` | `23.45ms` | `146.47ms` | `36.86ms` | `0.00%` | `0.00%` | RPS `+511.3%` (6.1x), P95 `-81.3%` (5.4x), P99 `-74.8%` | Membuktikan secara empiris: keuntungan kecepatan 6.1x berasal dari **Write-Behind decoupling**, bukan hanya RAM Redis. |

---

## 5. Detailed Observations & Notes
- **Case 01 (`arch:01` vs `base:01`)**: `arch:01` (`202 Accepted`) tetap 2.2x lebih cepat di P95 meski melakukan upload R2.
- **Case 02b (`arch:02b` vs `base:02b`)**: Tanpa `sleep(1)`, 60 VUs menghasilkan `461.43 RPS` di Redis (`p95 = 134.46ms`, lolos `<150ms`) vs `272.28 RPS` di DB (`p95 = 211.65ms`, gagal threshold).
- **Case 04 (`arch:04` vs `base:04`)**: Pengujian dengan payload gambar HD `sample-tile-hd.png` (~618 KB) menunjukkan transmisi biner Protobuf HTTP/2 pada gRPC (`554.77ms` P95, `594.95ms` P99) mengeliminasi latensi serialisasi multipart pada REST HTTP/1.1 (`5.10s` P95, `5.56s` P99).
- **Case 05 (`arch:05` vs `base:05`)**: `data_received` Express membuktikan beban outbound (`190 MB` static serving pada `base:05` vs `355 kB` pada `arch:05`).
- **Case 08 (`arch:08` vs `base:08`)**: `arch:08` hanya mengirim `31` HTTP requests (vs `501` pada `base:08`) dengan P99 `8.75s` (vs `16.50s`).

---

## 6. End-to-End User Journey Benchmarks

| Scenario | Script | Load Profile | RPS | Avg | P95 | P99 | Err % | Checks / Threshold | Kesimpulan |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **01. Smoke Test** | `scenarios/01-smoke.test.js` | `5 VUs`, `30s` | `4.72/s` (`181` reqs) | `59.32ms` | `392.29ms` | `508.70ms` | `0.00%` | `182/182` (100% PASS) | Seluruh alur utama (Auth, Monitor, Inspector, Buyer) berjalan 100% sehat di bawah threshold `<500ms`. |
| **02. Average Load** | `scenarios/02-average-load.test.js` | Peak `100 VUs` (65 Inspector + 25 Monitor + 10 Buyer), `5m` | `27.29/s` (`8.296` reqs) | `79.76ms` | `316.08ms` | `407.53ms` | `0.00%` | `8297/8297` (`P99 <800ms` PASS, `P95` tipis di atas `300ms`) | 0% error selama 5 menit penuh; P95 `316.08ms` sedikit melewati `300ms` karena 65 VU Inspector mengunggah gambar ke Cloudflare R2. |
| **03. Spike Upload** | `scenarios/03-spike-upload.test.js` | Spike `0 -> 150 VUs` dalam `10s`, tahan `1m`, `1m25s` total | `93.91/s` (`8.101` reqs) | `353.64ms` | `499.51ms` | `634.30ms` | `0.00%` | `8101/8101` (100% PASS `<1500ms`) | Lonjakan mendadak 150 VU upload ditangani mulus tanpa 1 pun error dengan P95 3x lebih cepat dari batas 1.5s. |
| **04. SSE Soak** | `scenarios/04-sse-soak.test.js` | `100` koneksi SSE persisten (`15s` hold), `2m45s` | `3.92/s` (`704` streams) | `14.99s` hold | `15.00s` hold | `15.00s` hold | `0.00%` (`sse_connected: 100%`) | `704/704` (100% PASS `>95%`) | 100 koneksi SSE persisten stabil penuh selama hampir 3 menit (`sse_connected = 100%`, `3.6 MB` total data). |

---

## 7. Empirical Durability & Chaos Test Results (Crash & Failure Resilience)

Script: `chaos/durability-chaos.test.mjs` (`npm run chaos:durability`)

| Chaos Test Case | Skenario Pengujian | Baseline Failure Mode | CeraScan Architecture Behavior | Measured Metric | Kesimpulan Rekayasa |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **Chaos 01: Queue Crash Durability** (`base:01b-mid` vs `arch:01b`) | 30 job upload gambar masuk serentak; proses pekerja di-terminasi tiba-tiba (*crash/restart*) sebelum seluruh job selesai diproses. | **In-Process RAM Queue**: 30 buffer gambar di heap V8 langsung hilang permanen saat proses mati. | **RabbitMQ Broker**: 30 pesan tersimpan di disk segment log antrean durable (`ai_scan_worker_queue`). Saat worker pulih, seluruh job diproses ulang. | Data Loss Rate: **`100.0%`** (In-Process) vs **`0.00%`** (RabbitMQ) | Keunggulan latensi beberapa ms pada in-process queue harus dibayar dengan hilangnya 100% data antrean saat crash; RabbitMQ menjamin durabilitas fisik pada level broker. |
| **Chaos 02: Write-Behind RPO Vulnerability** (`base:09b` vs `arch:09`) | 100 kuota di-decrement mendadak; Express/Redis di-kill sebelum batch sync ke MySQL berjalan. | **Atomic Single SQL (`09b`)**: Setiap `UPDATE` langsung ACID commit ke InnoDB redo log (RPO = 0). | **Redis Write-Behind (`09`)**: 100 decrement tersimpan di Redis; didukung persistensi AOF disk log (`appendfsync everysec`). | RPO Window: **`0 detik`** (SQL) vs **`≤ 1.0 detik`** (Redis AOF) / **`~60 detik`** (Non-AOF) | Pengukuran empiris: Dengan AOF `appendfsync everysec` aktif di Redis, jendela kehilangan data dibatasi maksimal 1 detik transaksi (0 decrement hilang jika di-kill > 1s). Kecepatan 4.288 RPS (+446%) dicapai dengan menerima trade-off jendela RPO ≤ 1 detik. |
