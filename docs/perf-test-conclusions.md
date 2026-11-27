# CeraScan Performance Test Conclusions (Per-Case Analysis)

- **Reference Report**: [perf-test-report.md](./perf-test-report.md)
- **Hypotheses Reference**: [performance-hypotheses.md](./performance-hypotheses.md)
- **Environment**: Local Benchmark (`http://localhost:3000`, `BENCH_PROFILE=local`)
- **Date**: 2026-11-28

---

## Ringkasan Eksekutif

Seluruh **8 pilar arsitektur CeraScan** telah divalidasi secara empiris melawan implementasi *baseline* tradisional/naif pada mesin, database, dan beban trafik yang sama (*apple-to-apple*).

Temuan kunci lintas pengujian:
1. **Keunggulan arsitektur modern muncul paling tegas saat sistem ditekan ke beban tinggi (*high-concurrency / high-spike*)**, bukan pada trafik ringan. Hal ini terbukti pada perbandingan skenario normal vs *high-load* di Case `01`/`01b` (RabbitMQ), `02`/`02b` (Redis), dan `06`/`06b` (CQRS).
2. **Setiap keputusan arsitektur memiliki *trade-off* yang terukur** (misalnya *network hop* upload ke Cloudflare R2 atau *open socket* pada SSE). Seluruh *trade-off* tersebut terkonfirmasi secara jujur melalui data dan terbukti sepadan dengan kapasitas, reliabilitas, dan *scalability* yang diperoleh.

---

## Kesimpulan Per Case

### Case 01 & 01b — RabbitMQ Async Queue (Load Leveling & Anti-OOM)
- **Verdict**: **Terbukti Telak**
- **Angka Kunci**:
  - **Normal (`01`, 20 VUs, 40s)**: Baseline P95 `1.23s` (P99 `1.43s`, `6.99/s`) vs Production P95 `558.47ms` (P99 `1.05s`, `8.25/s`). P95 turun **54.6% (2.2x lebih cepat)** dan RPS naik **+19.6%**.
  - **High-Spike (`01b`, 30 RPS, 25s)**: Baseline hanya sanggup `7.76/s` dengan **`500` dropped iterations**, Avg `6.37s`, P95 `8.35s`, P99 `8.74s` (mentok `60/60` VUs) vs Production `29.39/s` dengan **`0` dropped iterations**, Avg `343.67ms`, P95 `484.56ms`, P99 `755.29ms` (hanya butuh `9-16` VUs). P95 turun **94.2% (17.2x)**, P99 turun **91.4% (11.6x)**, dan RPS naik **+278.7%**.
- **Analisis**:
  - Pada beban ringan (`01`), `arch:01` sudah 2.2x lebih cepat di P95 meskipun masih ikut menanggung upload ke Cloudflare R2.
  - Pada lonjakan trafik (`01b`), arsitektur sinkron (*direct sync*) langsung kolaps karena setiap request HTTP menahan socket hingga inferensi AI selesai. Akibatnya antrean VU penuh (`60/60`) dan 500 request gagal masuk (*dropped*). Sebaliknya, RabbitMQ memisahkan penerimaan request (`202 Accepted`) dari pemrosesan ML sehingga API Gateway mampu melahap 30 RPS secara stabil tanpa menjatuhkan satu pun request.
- **Trade-off**: Hasil inferensi tidak langsung dikembalikan dalam HTTP response yang sama; klien harus menerima hasil secara asinkron (diselesaikan bersama Case 03 / SSE).

---

### Case 02 & 02b — Redis In-Memory Cache (Eliminasi Disk I/O & Agregasi DB)
- **Verdict**: **Terbukti (Signifikan pada High-RPS)**
- **Angka Kunci**:
  - **Normal (`02`, 80 VUs dengan `sleep(1)`, ~43 RPS)**: Baseline `43.65/s`, Avg `5.79ms`, P95 `10.41ms`, P99 `14.79ms` vs Production `43.48/s`, Avg `7.60ms`, P95 `12.08ms`, P99 `21.46ms`.
  - **High-RPS (`02b`, 60 VUs, tanpa sleep)**: Baseline `272.28/s`, Avg `122.93ms`, P95 `211.65ms` (gagal threshold `<150ms`), P99 `257.25ms` vs Production `461.43/s`, Avg `72.37ms`, P95 `134.46ms` (lolos threshold), P99 `175.48ms`. RPS naik **+69.5%**, P95 turun **36.5%**, P99 turun **31.8%**.
- **Analisis**:
  - Pada beban ringan (`02`), dataset yang kecil sudah ter-cache di *buffer pool* RAM database sehingga overhead tipis dari lapisan middleware Redis membuat latency keduanya hampir setara (`+1.67ms` di P95).
  - Saat trafik ditingkatkan maksimal (`02b`), agregasi langsung ke database membebani CPU dan *connection pool* hingga P95 jebol ke `211.65ms`. Redis menyingkirkan beban query berulang tersebut, mendongkrak throughput hampir 70%, dan menjaga P95 tetap di bawah batas 150ms.
- **Trade-off**: Menambah kompleksitas *cache invalidation* / TTL agar data dashboard tidak terlalu *stale*.

---

### Case 03 — Server-Sent Events / SSE (Persistent Stream vs Short Polling)
- **Verdict**: **Terbukti**
- **Angka Kunci (`100 Concurrent VUs`, 1m40s)**:
  - **Baseline (Short Polling)**: `29.38/s` (`3.339` request polling ke DB), Avg `6.55ms`, P95 `10.12ms`, P99 `13.13ms`, total bandwidth ~`3.0 MB`.
  - **Production (SSE)**: `3.70/s` (koneksi ditahan `15s` per siklus), total bandwidth ~`213 kB`.
  - **Delta**: Total HTTP requests turun **87.4% (7.9x lebih sedikit)** dan bandwidth turun **92.9%**.
- **Analisis**:
  - Metrik latency `15s` pada SSE bukan berarti sistem lambat, melainkan durasi *hold* koneksi streaming yang memang sengaja dibuka untuk menunggu event.
  - Short polling menciptakan *traffic amplification*: 100 klien yang diam menunggu tetap membanjiri server dan database dengan ribuan query kosong. SSE memangkas hampir 90% traffic HTTP dan lebih dari 92% konsumsi bandwidth.
- **Trade-off**: Server harus menahan *open socket / file descriptors* selama klien terhubung, sehingga perlu manajemen *keep-alive* dan batas koneksi per instance saat skala sangat besar.

---

### Case 04 — gRPC ML Inference (HTTP/2 Protobuf vs REST HTTP/1.1 Multipart)
- **Verdict**: **Terbukti Telak**
- **Angka Kunci (`8 RPS`, constant-arrival-rate, 30s, gambar HD `sample-tile-hd.png` ~618 KB)**:
  - **Baseline (REST FastAPI `:8000`)**: `4.90/s`, **`67` dropped iterations**, Avg `4.49s`, P95 `5.92s`, P99 `6.48s` (mentok `30` VUs, gagal threshold).
  - **Production (gRPC `:50051`)**: `7.92/s`, **`0` dropped iterations**, Avg `398.38ms`, P95 `554.77ms`, P99 `594.95ms` (hanya butuh `2-5` VUs).
  - **Delta**: P95 turun **90.6% (10.7x lebih cepat)**, P99 turun **90.8%**, `0` vs `67` dropped iterations.
- **Analisis**:
  - Untuk payload biner berukuran besar (~618 KB), REST HTTP/1.1 Multipart mengalami bottleneck pada serialisasi multipart, pembuatan koneksi baru, dan *head-of-line blocking*.
  - gRPC memanfaatkan biner Protobuf yang ringkas serta *HTTP/2 multiplexing* pada koneksi TCP persisten, sehingga throughput mendekati target penuh 8 RPS dengan pemakaian VU minimal dan latency 10x lebih rendah.
- **Trade-off**: Memerlukan manajemen kontrak `.proto` dan *tooling* debugging khusus dibanding REST JSON biasa.

---

### Case 05 — Cloudflare R2 Object Storage (Stateless Backend vs Local Disk)
- **Verdict**: **Terbukti (Sesuai Trade-off yang Diprediksi)**
- **Angka Kunci (`10 iter/s`, constant-arrival-rate, 30s)**:
  - **Baseline (Local Disk + Static Serving)**: `9.97/s`, Upload Avg `12.69ms`, P95 `34.34ms`, P99 `100.26ms`, namun disk lokal bertambah **`~190 MB`** dan Express menanggung **`190 MB` outbound static serving**.
  - **Production (Cloudflare R2)**: `9.89/s`, Upload Avg `401.34ms`, P95 `644.47ms`, P99 `870.26ms`, namun disk lokal **`0 MB`** dan outbound Express hanya **`355 kB` (-99.8%)**.
- **Analisis**:
  - Menulis ke SSD lokal memang jauh lebih cepat untuk operasi *write* tunggal (`12.69ms` vs `401.34ms` karena R2 memerlukan *network hop* HTTPS ke internet).
  - Namun, pendekatan Local Disk membuat backend menjadi *stateful* (tidak bisa di-scale horizontal dengan mudah), menghabiskan ruang disk server secara linear (`~190 MB` hanya dalam 30 detik), dan memaksa Express melayani *static file* yang menguras bandwidth. Cloudflare R2 meng-offload 99.8% beban outbound dan menjaga backend 100% *stateless*.
- **Trade-off**: Latency upload lebih tinggi karena *network hop* eksternal; dalam arsitektur CeraScan, dampak ini diminimalkan dengan jalur asinkron (RabbitMQ) atau *presigned URL*.

---

### Case 06 & 06b — CQRS & Polyglot DB (Isolasi Read/Write vs Monolith)
- **Verdict**: **Terbukti Telak pada High-RPS**
- **Angka Kunci**:
  - **Normal (`06`, 40 Read + 5 Write RPS, 30s)**: Baseline `44.42/s` (Read Avg `9.10ms`, Write Avg `369ms`) vs Production `44.55/s` (Read Avg `8.00ms`, Write Avg `364ms`). Keduanya sama stabilnya pada beban rendah.
  - **High-RPS (`06b`, 250 Read + 15 Write RPS, 30s)**:
    - **Baseline (Monolith MySQL)**: `169.08/s`, **`2777` dropped iterations**, Read Avg `626ms` / P95 `810ms` / P99 `850ms`, Write Avg `1025ms` / P95 `1238ms` / P99 `1336ms`.
    - **Production (CQRS + Polyglot)**: `259.81/s`, **`25` dropped iterations**, Read Avg `51.1ms` / P95 `155ms` / P99 `219ms`, Write Avg `377ms` / P95 `544ms` / P99 `739ms`.
    - **Delta**: Read Avg turun **91.8% (12.3x)**, Write Avg turun **63.2% (2.7x)**, dan *dropped iterations* anjlok dari `2777` menjadi `25`.
- **Analisis**:
  - Pada beban ringan (`06`), database tunggal belum mengalami kontensi sehingga CQRS terlihat belum berbeda jauh.
  - Saat beban baca analitik dinaikkan ke 250 RPS bersamaan dengan 15 Write RPS (`06b`), pendekatan monolitik mengalami *resource contention* parah: query baca berat menyita *connection pool* dan I/O MySQL sehingga transaksi tulis ikut melambat hingga >1 detik. CQRS mengisolasi beban baca ke *read-model* (Redis/MongoDB), menjaga jalur tulis di MySQL tetap ringan dan responsif.
- **Trade-off**: Sistem menjadi *eventually consistent* (ada jeda sinkronisasi dari *write-model* ke *read-model*) dan membutuhkan pemeliharaan dua skema data.

---

### Case 07 — Dead Letter Queue / DLQ (Fault Tolerance & Zero Data Loss)
- **Verdict**: **Terbukti**
- **Angka Kunci (`20 shared-iterations`, 5 VUs — Simulasi Worker Down)**:
  - **Baseline (`fail-and-forget`)**: `4.88/s`, Avg `4.68ms`, P95 `3.99ms`, P99 `56.78ms`, Error Rate **`95.23%`** (**100% data loss** — 20/20 request langsung mengembalikan HTTP 500 dan hilang permanen).
  - **Production (DLQ)**: `4.85/s`, Avg `10.85ms`, P95 `21.93ms`, P99 `60.76ms`, Error Rate **`0.00%`** (**0% data loss**).
- **Analisis**:
  - Baseline merespons sedikit lebih cepat (`4.68ms`) semata-mata karena langsung melempar error HTTP 500 dan membuang request user.
  - Arsitektur DLQ menambah sedikit waktu pemrosesan (~`6ms` di Avg), namun menjamin tidak ada satu pun tugas scan yang hilang saat downstream/worker bermasalah. Pesan gagal tersimpan rapi di DLQ untuk diinspeksi dan di-*retry* setelah layanan pulih.
- **Trade-off**: Memerlukan mekanisme monitoring, alerting, serta prosedur *replay/retry* DLQ agar pesan gagal tidak menumpuk tanpa penanganan.

---

### Case 08 — Batch Upload Pipeline (Reduksi Network & Handshake Overhead)
- **Verdict**: **Terbukti**
- **Angka Kunci (`2 batch/s`, 10 gambar/batch, 30s)**:
  - **Baseline (`single-loop`, 10 request satuan per batch)**: `1.26/s`, total **`501` HTTP requests**, Avg `9.12s`, P95 `14.82s`, P99 `16.50s`, Error `0.00%`.
  - **Production (`/api/scans/batch`)**: `0.50/s` (batch/s), total **`31` HTTP requests**, Avg `5.46s`, P95 `8.32s`, P99 `8.75s`, Error `0.00%`.
  - **Delta**: P95 turun **43.9%**, P99 turun **47.0%**, dan jumlah koneksi/request HTTP turun **93.8%** (`31` vs `501`).
- **Analisis**:
  - Menggabungkan 10 gambar ke dalam satu request multipart menghilangkan overhead pengulangan HTTP handshake, autentikasi, dan validasi kuota per file.
  - Sesuai catatan kalibrasi hipotesa, percepatan bukan 10x penuh karena setiap gambar di server tetap harus melalui upload R2 dan pencatatan DB, tetapi pemangkasan latency P95/P99 hampir separuh dan reduksi 93.8% jumlah request HTTP sangat signifikan untuk efisiensi jaringan klien maupun API Gateway.
- **Trade-off**: Ukuran payload per HTTP request lebih besar, sehingga batas *max body size* (Nginx/Express) dan penanganan *partial failure* dalam satu batch harus dikonfigurasi dengan cermat.

---

### Case 09 — Redis Atomic Quota + Write-Behind (Hot-Row Lock Elimination)
- **Verdict**: **Terbukti Telak**
- **Angka Kunci (`60 VUs`, Hot-User Burst pada 1 `user_id` yang sama, 20s, tanpa sleep)**:
  - **Baseline (MySQL `SELECT ... FOR UPDATE`)**: `127.45/s` (`2.613` requests), Avg `463.70ms`, P95 `617.83ms` (gagal threshold `<150ms`), P99 `727.87ms`, Error `0.00%`.
  - **Production (Redis `decrBy` + Write-Behind)**: `4288.53/s` (`85.928` requests), Avg `13.84ms`, P95 `23.45ms` (lolos threshold), P99 `36.86ms`, Error `0.00%`.
  - **Delta**: RPS naik **+3.265% (33.6x)**, Avg turun **97.0%**, P95 turun **96.2% (26.3x)**, P99 turun **94.9% (19.7x)**.
- **Analisis**:
  - Berbeda dengan Case 02 (Redis Cache untuk *read*), Case 09 menguji *write-heavy atomic counter*. Saat 60 VU bersamaan mengurangi kuota milik 1 akun yang sama, MySQL terpaksa mengantrekan transaksi lewat *row-level lock* (`SELECT ... FOR UPDATE`) sehingga throughput mentok di `127 RPS` dengan latency P95 >600ms.
  - Redis `decrBy` mengeksekusi pengurangan secara atomik di memori tanpa mengunci baris MySQL (yang baru disinkronkan secara periodik via `syncQuotasToDatabase()`), menghasilkan throughput **4.288 RPS** dengan latency P99 hanya `36.86ms`. Pada uji awal dengan kuota `20.000` dan `63.451` request masuk, tepat `20.000` request lolos (`200`) dan `43.451` ditolak (`429`) — **0% overselling**.
- **Trade-off**: Data `used_quota` di MySQL bersifat *eventually consistent* (mengikuti jadwal sinkronisasi *write-behind*); jika Redis mengalami restart tanpa persistensi AOF/RDB sebelum sinkronisasi berjalan, selisih kuota terbaru di memori berisiko hilang.

---

## Kesimpulan Umum Arsitektur

Berdasarkan seluruh rangkaian benchmark lokal ini, arsitektur CeraScan terbukti **bukan sekadar over-engineering**:
- **Resilience & Stability**: RabbitMQ (`01b`) dan DLQ (`07`) mencegah server jebol saat *traffic spike* serta memastikan **0% data loss** saat worker gagal.
- **Throughput & Low Latency**: Redis (`02b`), gRPC (`04`), dan CQRS (`06b`) memangkas latency P95/P99 hingga **36%–94%** dan menaikkan kapasitas RPS secara drastis di bawah beban tinggi.
- **Resource & Network Efficiency**: SSE (`03`), Cloudflare R2 (`05`), dan Batch Upload (`08`) menekan konsumsi bandwidth outbound/polling hingga **>92%** serta menjaga backend tetap **stateless** dan siap di-scale secara horizontal.
