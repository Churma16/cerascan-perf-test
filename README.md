# CeraScan Performance & Load Testing Suite (k6)

Repositori ini memuat *automated performance test suite* berskala produksi untuk **CeraScan API Gateway**, dirancang menggunakan [Grafana k6](https://k6.io/).

Dokumen spesifikasi dan rincian analitis pemetaan beban endpoint dapat dilihat di [docs/endpoint-load-analysis.md](docs/endpoint-load-analysis.md).

---

## 🚀 Fitur & Cakupan Uji

1. **User Journey Modular**:
   - **Inspector Flow (65%)**: Login, Cek kuota, Upload gambar keramik (Multipart), dan Polling riwayat.
   - **Monitor Flow (25%)**: Visualisasi Dashboard KPI, Scan Trends, Model Insights, dan Leaderboards.
   - **Buyer Flow (10%)**: Katalog paket plan, Checkout Snap, dan Verifikasi kuota.
2. **Skenario Pengujian Terstandardisasi**:
   - `01-smoke.test.js`: Verifikasi fungsional cepat (5 VUs, 30s).
   - `02-average-load.test.js`: Beban jam kerja normal (Weighted traffic, ramp-up 100 VUs).
   - `03-spike-upload.test.js`: Lonjakan mendadak upload (0 $\rightarrow$ 150 VUs dalam 10s) untuk menguji Cloudflare R2 & antrean RabbitMQ.
   - `04-sse-soak.test.js`: Uji ketahanan koneksi persisten Server-Sent Events (`/api/sse/events`).
3. **Single-Endpoint Stress Benchmarks (Hotspot Isolation)**:
   - `leaderboard-stress.js`: Uji batas throughput Redis in-memory cache (`GET /api/leaderboards`, ramp-up ke 1.000 RPS).
   - `dashboard-kpi-stress.js`: Uji ketahanan cache hit rate saat 300 user membuka dashboard bersamaan (`GET /api/dashboard/kpi`).
   - `quota-check-stress.js`: Uji pre-flight kuota konstan 300 RPS (`GET /api/user-quotas/:user_id`).
   - `scan-upload-stress.js`: Uji titik jenuh buffer RAM Express Multer & publish RabbitMQ (`POST /api/scans`).

---

## 🛠️ Cara Menjalankan

### Persyaratan
- [k6 CLI](https://k6.io/docs/get-started/installation/) terinstall, **atau** menggunakan [Docker](https://hub.docker.com/r/grafana/k6).

### Konfigurasi Environment
Salin template environment:
```bash
cp .env.example .env
```
Variabel yang didukung:
- `BASE_URL`: URL target API (default: `https://api-ceramic.churma.codes` atau `http://localhost:5000`).
- `TEST_USER_EMAIL`: Akun penguji terdaftar.
- `TEST_USER_PASSWORD`: Password akun penguji.
- `USER_POOL_SIZE`: Jumlah pool akun pengguna untuk simulasi multi-tenant (default: `10`, rentang 1..10).

### Menjalankan Uji (Native k6)
```bash
# Smoke test (30 detik)
k6 run scenarios/01-smoke.test.js

# Average load test
k6 run scenarios/02-average-load.test.js

# Spike upload test
k6 run scenarios/03-spike-upload.test.js

# Single-Endpoint Benchmarks
k6 run scenarios/endpoints/leaderboard-stress.js
k6 run scenarios/endpoints/dashboard-kpi-stress.js
k6 run scenarios/endpoints/quota-check-stress.js
k6 run scenarios/endpoints/scan-upload-stress.js

# Custom target URL
BASE_URL="http://localhost:5000" k6 run scenarios/01-smoke.test.js
```

### Menjalankan Uji via Docker
```bash
# Skenario Utama
docker run --rm -i -v $(pwd):/app -w /app grafana/k6 run scenarios/01-smoke.test.js
docker run --rm -i -v $(pwd):/app -w /app grafana/k6 run scenarios/02-average-load.test.js

# Single-Endpoint Benchmarks via Docker
npm run docker:bench:leaderboard
npm run docker:bench:dashboard
npm run docker:bench:quota
npm run docker:bench:upload
```

---

## 📊 Live Observability
Selama pengujian berlangsung, pantau metrik real-time melalui Grafana (`https://grafana.churma.codes`):
- `http_request_duration_seconds` (P95, P99 Latency).
- `http_requests_total` (Throughput / RPS).
- `active_sse_connections` (Gauge koneksi SSE aktif).
