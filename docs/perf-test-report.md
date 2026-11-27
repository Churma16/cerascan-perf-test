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

| Case | Pilar Arsitektur | k6 Target RPS / Load | Base RPS | Prod RPS | Base Avg | Prod Avg | Base P95 | Prod P95 | Base P99 | Prod P99 | Base Err % | Prod Err % | Delta | Kesimpulan |
| :-: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- |
| **01** | **RabbitMQ Async Queue (Normal)** (`arch:01` vs `base:01`) | `20 VUs` (40s, ramping-vus) | `6.99/s` | `8.25/s` | `622.43ms` | `354.09ms` | `1.23s` | `558.47ms` | `1.43s` | `1.05s` | `0.00%` | `0.00%` | P95 `-54.6%` (2.2x), RPS `+19.6%` | RabbitMQ menyerap beban upload tanpa menahan socket, meski `arch:01` ikut mengunggah ke R2. |
| **01b** | **RabbitMQ Async Queue (High-Spike)** (`arch:01b` vs `base:01b`) | `30 RPS` (constant-arrival-rate, 25s) | `7.76/s` (500 dropped) | `29.39/s` (0 dropped) | `6.37s` | `343.67ms` | `8.35s` | `484.56ms` | `8.74s` | `755.29ms` | `0.00%` | `0.00%` | P95 `-94.2%` (17.2x), P99 `-91.4%` (11.6x), RPS `+278.7%` | Terbukti telak! Direct Sync jebol di 60 VUs & drop 500 request; RabbitMQ melahap 30 RPS dengan 0 dropped hanya pakai 9-16 VUs. |
| **02** | **Redis Cache (Normal)** (`arch:02` vs `base:02`) | `80 VUs` (~43 RPS, sleep 1s) | `43.65/s` | `43.48/s` | `5.79ms` | `7.60ms` | `10.41ms` | `12.08ms` | `14.79ms` | `21.46ms` | `0.00%` | `0.00%` | RPS `-0.4%`, P95 `+1.67ms` | Pada beban ringan (~43 RPS) & data kecil di RAM DB, overhead middleware Redis terlihat tipis. |
| **02b** | **Redis Cache (High-RPS)** (`arch:02b` vs `base:02b`) | `60 VUs` (Max RPS, no sleep) | `272.28/s` | `461.43/s` | `122.93ms` | `72.37ms` | `211.65ms` | `134.46ms` | `257.25ms` | `175.48ms` | `0.00%` | `0.00%` | RPS `+69.5%`, P95 `-36.5%`, P99 `-31.8%` | Saat trafik tinggi (no sleep), Redis unggul telak dan lolos threshold `<150ms`, sedangkan DB gagal threshold. |
| **03** | **SSE Persistent Stream** (`arch:03` vs `base:03`) | `100 Concurrent VUs` (1m40s) | `29.38/s` | `3.70/s` | `6.55ms` | `15s` hold | `10.12ms` | `15s` hold | `13.13ms` | `15s` hold | `0.00%` | `0.00%` | Reqs `-87.4%` (7.9x), Bandwidth `-92.9%` | SSE menghilangkan 3.339 query polling DB & menghemat 92.9% bandwidth (213 kB vs 3.0 MB). |
| **04** | **gRPC ML Inference** (`arch:04` vs `base:04`) | `8 RPS` (constant-arrival-rate, 30s) | `4.90/s` | `7.92/s` | `4.49s` | `398.38ms` | `5.92s` | `554.77ms` | `6.48s` | `594.95ms` | `0.00%` | `0.00%` | P95 `-90.6%` (10.7x), P99 `-90.8%`, Dropped `0` vs `67` | gRPC hanya butuh 2-5 VUs dengan 0 dropped; REST kewalahan di 30 VUs, 67 dropped, & gagal threshold. |
| **05** | **Cloudflare R2 Storage** (`arch:05` vs `base:05`) | `10 iter/s` (constant-arrival-rate, 30s) | `9.97/s` | `9.89/s` | `12.69ms` (upload) | `401.34ms` (upload) | `34.34ms` (upload) | `644.47ms` (upload) | `100.26ms` (upload) | `870.26ms` (upload) | `0.00%` | `0.00%` | Disk lokal `0 MB` vs `~190 MB`, Outbound `-99.8%` | Local Disk lebih cepat di write SSD lokal, namun membebani Express 190 MB static serving; R2 menjaga backend 100% stateless. |
| **06** | **CQRS & Polyglot DB (Normal)** (`arch:06` vs `base:06`) | `40 Read + 5 Write RPS` (30s) | `44.42/s` | `44.55/s` | `9.10ms` (R) / `369ms` (W) | `8.00ms` (R) / `364ms` (W) | `14.20ms` (R) / `561ms` (W) | `13.11ms` (R) / `508ms` (W) | `18.66ms` (R) / `687ms` (W) | `17.52ms` (R) / `638ms` (W) | `0.00%` | `0.00%` | Read/Write stabil | Pada beban ringan (~45 RPS), MySQL & CQRS sama cepatnya. |
| **06b** | **CQRS & Polyglot DB (High-RPS)** (`arch:06b` vs `base:06b`) | `250 Read + 15 Write RPS` (30s) | `169.08/s` | `259.81/s` | `626ms` (R) / `1025ms` (W) | `51.1ms` (R) / `377ms` (W) | `810ms` (R) / `1238ms` (W) | `155ms` (R) / `544ms` (W) | `850ms` (R) / `1336ms` (W) | `219ms` (R) / `739ms` (W) | `0.00%` | `0.00%` | Read Avg `-91.8%` (12.3x), Write Avg `-63.2%` (2.7x), Dropped `25` vs `2777` | Terbukti! Pada Monolith, query baca berat mengunci/menghambat transaksi tulis hingga >1s; CQRS menjaga Read & Write terisolasi penuh. |
| **07** | **Dead Letter Queue (DLQ)** (`arch:07` vs `base:07`) | `20 shared-iterations` (5 VUs) | `4.88/s` | `4.85/s` | `4.68ms` | `10.85ms` | `3.99ms` | `21.93ms` | `56.78ms` | `60.76ms` | `95.23%` (100% loss) | `0.00%` | Data loss `0%` vs `100%` | `base:07` langsung melempar HTTP 500 (20/20 request hilang); `arch:07` menjamin 0% data loss & retryability. |
| **08** | **Batch Upload Pipeline** (`arch:08` vs `base:08`) | `2 batch/s` (10 img/batch, 30s) | `1.26/s` | `0.50/s` | `9.12s` | `5.46s` | `14.82s` | `8.32s` | `16.50s` | `8.75s` | `0.00%` | `0.00%` | P95 `-43.9%`, P99 `-47.0%`, HTTP reqs `-93.8%` (`31` vs `501`) | Batch upload memangkas latency P95/P99 hampir separuh & memangkas 93.8% jumlah koneksi HTTP. |
| **09** | **Redis Atomic Quota + Write-Behind** (`arch:09` vs `base:09`) | `60 VUs` (Hot-User Burst, 20s, no sleep) | `127.45/s` | `4288.53/s` | `463.70ms` | `13.84ms` | `617.83ms` | `23.45ms` | `727.87ms` | `36.86ms` | `0.00%` | `0.00%` | RPS `+3265%` (33.6x), P95 `-96.2%` (26.3x), P99 `-94.9%` (19.7x) | Terbukti telak! MySQL row-lock (`SELECT ... FOR UPDATE`) mengalami *hot-row contention* di 127 RPS; Redis `decrBy` melahap 4.288 RPS tanpa lock & 0% overselling. |

---

## 5. Detailed Observations & Notes
- **Case 01 (`arch:01` vs `base:01`)**: `arch:01` (`202 Accepted`) tetap 2.2x lebih cepat di P95 meski melakukan upload R2.
- **Case 02b (`arch:02b` vs `base:02b`)**: Tanpa `sleep(1)`, 60 VUs menghasilkan `461.43 RPS` di Redis (`p95 = 134.46ms`, lolos `<150ms`) vs `272.28 RPS` di DB (`p95 = 211.65ms`, gagal threshold).
- **Case 04 (`arch:04` vs `base:04`)**: Menggunakan gambar HD `sample-tile-hd.png` (~618 KB) membuktikan keunggulan telak HTTP/2 Protobuf biner gRPC (`554.77ms` P95, `594.95ms` P99) dibanding REST HTTP/1.1 multipart (`5.92s` P95, `6.48s` P99).
- **Case 05 (`arch:05` vs `base:05`)**: `data_received` Express membuktikan beban outbound (`190 MB` static serving pada `base:05` vs `355 kB` pada `arch:05`).
- **Case 08 (`arch:08` vs `base:08`)**: `arch:08` hanya mengirim `31` HTTP requests (vs `501` pada `base:08`) dengan P99 `8.75s` (vs `16.50s`).
