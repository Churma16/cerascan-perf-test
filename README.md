# CeraScan Performance & Load Testing Suite (k6)

Repositori ini memuat automated performance test suite berskala produksi untuk **CeraScan API Gateway**, dirancang menggunakan [Grafana k6](https://k6.io/).

Dokumen spesifikasi dan rincian analitis pemetaan beban endpoint dapat dilihat di [docs/endpoint-load-analysis.md](docs/endpoint-load-analysis.md).

---

## 8 Pilar Arsitektur yang Diuji (Production Flow)

Suite ini secara komprehensif menguji 8 pilar arsitektur backend CeraScan tanpa celah:
1. **RabbitMQ Async Queueing**: Dekopel beban upload (`POST /api/scans` -> 202 Accepted, worker processing di background).
2. **Redis In-Memory Caching**: Caching agregasi metrik (`GET /api/dashboard/admin-kpi`, `GET /api/scans/leaderboard`) dengan latency < 15ms.
3. **Server-Sent Events (SSE)**: Push real-time hasil inferensi AI (`GET /api/sse/events`) tanpa membebani server dengan short polling.
4. **gRPC ML Inference Engine**: Komunikasi biner HTTP/2 Protobuf antara Express dan Python worker di port 50051.
5. **Cloudflare R2 Object Storage**: Penyimpanan gambar stateless multi-cloud yang aman dari saturasi disk server.
6. **Polyglot Persistence**: Pemisahan tegas transaksi ACID (MySQL) dan data telemetri analitik dokumen (MongoDB).
7. **Dead Letter Queue (DLQ)**: Mekanisme fault tolerance & retry saat terjadi kendala worker (`GET /api/dlq`).
8. **Batch Upload Pipeline**: Multi-file streaming (`POST /api/scans/batch`) yang memotong 80% overhead koneksi jaringan.

---

## Fitur & Cakupan Uji

1. **User Journey Modular**:
   - **Inspector Flow (65%)**: Login, Cek kuota, Upload gambar keramik (Multipart), dan Polling riwayat.
   - **Monitor Flow (25%)**: Visualisasi Dashboard KPI, Scan Trends, Model Insights, dan Leaderboards.
   - **Buyer Flow (10%)**: Katalog paket plan, Checkout Snap, dan Verifikasi kuota.
2. **Skenario Pengujian Terstandardisasi**:
   - `01-smoke.test.js`: Verifikasi fungsional cepat seluruh journey (5 VUs, 30s).
   - `02-average-load.test.js`: Beban jam kerja normal (Weighted traffic, ramp-up 100 VUs).
   - `03-spike-upload.test.js`: Lonjakan mendadak upload (0 -> 150 VUs dalam 10s) untuk menguji Cloudflare R2 & antrean RabbitMQ.
   - `04-sse-soak.test.js`: Uji ketahanan koneksi persisten Server-Sent Events (`/api/sse/events`).
3. **Single-Endpoint Stress Benchmarks (Hotspot Isolation)**:
   - `scan-upload-stress.js`: Uji throughput upload single file & publish RabbitMQ (`POST /api/scans`).
   - `batch-upload-stress.js`: Uji batch upload multipart streaming (`POST /api/scans/batch`).
   - `leaderboard-stress.js`: Uji batas throughput Redis in-memory cache (`GET /api/scans/leaderboard`).
   - `dashboard-kpi-stress.js`: Uji ketahanan cache hit rate saat concurrent traffic (`GET /api/dashboard/admin-kpi`).
   - `model-insight-stress.js`: Uji agregasi MongoDB & analitik defect (`GET /api/model-insights/kpi`).
   - `dlq-stress.js`: Uji monitoring & fault tolerance antrean mati (`GET /api/dlq`).
   - `quota-check-stress.js`: Uji pre-flight kuota konstan (`GET /api/user-quotas/me`).

---

## Cara Menjalankan

### Persyaratan
- [k6 CLI](https://k6.io/docs/get-started/installation/) terinstall, **atau** menggunakan [Docker](https://hub.docker.com/r/grafana/k6).

### Konfigurasi Environment
Salin template environment:
```bash
cp .env.example .env
```
Variabel yang didukung:
- `BASE_URL`: URL target API (default fallback: `http://localhost:3000` atau `https://api-ceramic.churma.codes`).
- `TEST_USER_EMAIL`: Akun penguji terdaftar (default: `admin@cerascan.com`).
- `TEST_USER_PASSWORD`: Password akun penguji (default: `Password123!`).
- `USER_POOL_SIZE`: Jumlah pool akun pengguna untuk simulasi multi-tenant (default: `1`).

### Menjalankan Uji (NPM Scripts)
```bash
# Skenario End-to-End
npm run test:smoke     # Functional smoke verification
npm run test:load      # Average load test (100 VUs)
npm run test:spike     # Spike burst test (150 VUs)
npm run test:sse       # SSE connection soak test

# Single-Endpoint Hotspot Benchmarks
npm run bench:upload        # Single scan upload
npm run bench:batch         # Multi-image batch upload
npm run bench:dashboard     # Dashboard KPI
npm run bench:leaderboard   # Leaderboard ranking
npm run bench:insight       # Model insights KPI
npm run bench:dlq           # Dead Letter Queue inspection
npm run bench:quota         # Quota check
```

### Menjalankan Uji (Native k6 CLI)
```bash
# Smoke test
k6 run scenarios/01-smoke.test.js

# Custom target URL via env
k6 run -e BASE_URL=http://localhost:3000 scenarios/01-smoke.test.js
```

### Menjalankan Uji via Docker
```bash
docker run --rm -i -v $(pwd):/app -w /app grafana/k6 run scenarios/01-smoke.test.js
```

---

## Observabilitas Real-Time
Selama pengujian berlangsung, pantau metrik real-time melalui Grafana (`https://grafana.churma.codes` atau Prometheus lokal `/metrics`):
- `http_request_duration_seconds` (P95, P99 Latency).
- `http_requests_total` (Throughput / RPS).
- `active_sse_connections` (Gauge koneksi SSE aktif).
- RabbitMQ Management Console (`http://localhost:15672`).
