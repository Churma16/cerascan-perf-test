# CeraScan Performance Testing Hypotheses (8 Architectural Pillars)

Dokumen ini mendefinisikan hipotesa kinerja sebelum eksekusi benchmark komparatif (Production Architecture vs Baseline) pada ekosistem **CeraScan Backend**. Setiap hipotesa dilengkapi metrik utama, *trade-off* yang diakui, dan kriteria validasi objektif.

---

## Ringkasan Matriks Hipotesa

| No | Pilar Arsitektur | Target Produksi | Target Baseline | Fokus Metrik Utama |
| :-: | :--- | :--- | :--- | :--- |
| **01** | RabbitMQ Async Queue | `POST /api/scans` | `POST /api/baseline/scans/sync` | RAM/CPU Stability (Anti-OOM), Latency p95, Error Rate |
| **02** | Redis In-Memory Cache | `GET /api/dashboard/kpi` | `GET /api/baseline/dashboard/no-cache` | Latency p95/p99, DB CPU & Connection Pool |
| **03** | Server-Sent Events (SSE) | `GET /api/sse/events` | Polling `GET /api/baseline/scans/poll-status?scanId=latest` | Total HTTP Requests/sec, CPU & DB Load |
| **04** | gRPC ML Inference | `POST /api/baseline/scans/grpc-inference` (gRPC `:50051`) | `POST /api/baseline/scans/rest-inference` (REST `:8000`) | Inference Roundtrip Time, Payload Size, Connection Reuse |
| **05** | Cloudflare R2 Storage | `POST /api/scans` + Core Impact Check | `POST /api/baseline/scans/local-disk` + Static `/uploads` + Core Impact | Upload Latency Trade-off, Serving & Core Impact Latency, Local Disk Growth |
| **06** | CQRS & Polyglot DB | Concurrent `GET /api/dashboard/kpi` + `POST /api/scans` | Concurrent `GET /api/baseline/dashboard/monolith` + `POST /api/scans` | Read Latency, Write Isolation, Eventual Consistency Lag |
| **07** | Dead Letter Queue (DLQ) | Chaos Test: Worker Down -> `GET /api/dlq` + Retry | `POST /api/baseline/scans/fail-and-forget` | Data Loss Rate (%), Recovery Rate (%) |
| **08** | Batch Upload Pipeline | `POST /api/scans/batch` (3 images) | Looping 3x `POST /api/scans` | Total Batch Duration, Network Handshake Overhead |

---

## Rincian Hipotesa per Kasus

### 01. RabbitMQ Async Queueing (Load Leveling & Anti-OOM)
- **Hipotesa**: Penggunaan RabbitMQ sebagai *message broker* asinkron menahan lonjakan beban (*spike*) agar resource CPU dan RAM pada Express serta Python ML Worker tidak melonjak ekstrem hingga menyebabkan **OOM (Out of Memory)** atau *connection starvation*.
- **Perbandingan**:
  - *Production*: Express menerima upload, simpan ke storage, publish pesan `scan.process` ke RabbitMQ, dan langsung merespons `202 Accepted`. Worker memproses antrean secara terkendali (`prefetchCount`).
  - *Baseline*: Express memanggil inferensi AI secara sinkron dan menahan koneksi HTTP hingga selesai.
- **Kriteria Validasi**:
  - Production mempertahankan `http_req_failed < 5%` dan penggunaan RAM stabil (tidak OOM) saat spike 50+ VU, sedangkan Baseline mengalami lonjakan latency tajam / timeout (`504`/`500`) dan lonjakan memori linear.

---

### 02. Redis In-Memory Caching (Eliminasi Disk I/O)
- **Hipotesa**: Menyimpan hasil agregasi dashboard dan leaderboard di memori RAM (Redis) menghilangkan kebutuhan Disk I/O dan kalkulasi ulang query database, sehingga waktu respons jauh lebih cepat dibandingkan query langsung ke database.
- **Perbandingan**:
  - *Production*: Request membaca langsung dari Redis cache (`< 25ms`).
  - *Baseline*: Setiap request memaksa query agregasi ulang langsung ke MySQL/MongoDB.
- **Kriteria Validasi**:
  - Latency p95 Production secara signifikan lebih rendah (target `< 50ms`) dibanding Baseline, dengan beban CPU dan koneksi aktif database tetap rendah.

---

### 03. Server-Sent Events / SSE (Efisiensi Resource vs Short Polling)
- **Hipotesa**: Koneksi streaming persisten SSE jauh lebih hemat resource CPU dan database dibandingkan *short polling* berkala karena tidak menghasilkan *traffic amplification* dari request HTTP kosong yang berulang.
- **Trade-off**: SSE menahan *open socket / file descriptors* selama klien terhubung, namun konsumsi CPU dan query DB mendekati nol saat idle.
- **Kriteria Validasi**:
  - Untuk jumlah klien aktif yang sama (misal 50-100 VU), total jumlah HTTP request dan beban CPU/DB pada SSE jauh lebih rendah dibandingkan *short polling* tiap 2 detik.

---

### 04. gRPC ML Inference (Protobuf Biner & HTTP/2 Multiplexing)
- **Hipotesa**: Komunikasi Express ke Python ML menggunakan gRPC memberikan waktu respons lebih cepat dibanding REST HTTP/1.1 karena payload gambar dikirim dalam format biner Protobuf (tanpa overhead parsing teks/MIME) dan menggunakan kembali koneksi TCP persisten (*HTTP/2 multiplexing*) tanpa membuka koneksi baru di setiap request.
- **Kriteria Validasi**:
  - Waktu roundtrip inferensi p95 pada jalur gRPC lebih rendah dan lebih stabil di bawah konkurensi tinggi dibandingkan jalur REST HTTP/1.1 (`POST /predict`).

---

### 05. Cloudflare R2 Object Storage (Delegasi I/O & Stateless Service)
- **Hipotesa**: Mendelegasikan penyimpanan dan distribusi file gambar ke Cloudflare R2 mencegah saturasi Disk I/O lokal dan kepenuhan storage pada server tempat aplikasi berjalan, sekaligus menjaga kontainer backend tetap *stateless*.
- **Dua Sisi Latency (*Trade-off* yang Diukur)**:
  - *Upload Latency (Write)*: Local Disk (`local_upload_latency_ms`) pada beban ringan akan lebih cepat karena menulis langsung ke SSD lokal, sedangkan R2 (`r2_upload_latency_ms`) memiliki *network hop* HTTPS.
  - *Serving & Core Service Impact Latency*: Pada Baseline, static file serving (`local_serving_latency_ms`) dan write disk lokal membebani I/O & bandwidth server yang sama sehingga berpotensi mengganggu latency endpoint inti (`core_service_impact_latency_ms`), sedangkan R2 meng-offload 100% beban serving ke Cloudflare Edge.
- **Kriteria Validasi**:
  - Disk usage lokal server tidak bertambah (0 MB) dan `core_service_impact_latency_ms` tetap stabil rendah pada Production, sedangkan pada Baseline (`local-disk`) ukuran direktori lokal meningkat linear dan server harus melayani beban static file serving sendiri.

---

### 06. CQRS & Polyglot Persistence (Optimasi Read vs Trade-off Write)
- **Hipotesa**: Pemisahan jalur Command (Write ke MySQL + Event Stream) dan Query (Read dari proyeksi MongoDB/Redis) membuat performa **Read jauh lebih cepat dan terisolasi**, dengan *trade-off* adanya tambahan overhead pemrosesan pada jalur **Write** (sinkronisasi ke *read-model* / *eventual consistency*).
- **Kriteria Validasi**:
  - Saat beban baca analitik tinggi berjalan bersamaan dengan transaksi tulis, latency baca pada CQRS tetap stabil dan tidak mengunci (*lock*) transaksi tulis di MySQL, tidak seperti pendekatan monolitik (`dashboard/monolith`).

---

### 07. Dead Letter Queue / DLQ (Fault Tolerance & Recoverability)
- **Hipotesa**: Mekanisme DLQ menjamin *zero data loss* dengan memarkir pesan yang gagal diproses ke antrean khusus (`scan.dlq` / tabel `dead_letter_messages`) sehingga dapat diinspeksi dan diproses ulang (*retry*) saat layanan pulih, alih-alih hilang permanen.
- **Kriteria Validasi**:
  - Pada simulasi kegagalan worker, Baseline (`fail-and-forget`) menghasilkan **100% data loss** (langsung 500 tanpa jejak), sedangkan arsitektur DLQ mempertahankan **0% data loss** dengan seluruh pesan gagal tercatat dan dapat di-retry.

---

### 08. Batch Upload Pipeline (Reduksi Network & Handshake Overhead)
- **Hipotesa**: Mengunggah banyak gambar dalam 1 request multipart tunggal (`/api/scans/batch`) secara signifikan lebih cepat (estimasi realistis **2x-5x lebih cepat** tergantung ukuran file dan latency jaringan) dibanding melakukan looping request satuan dari klien, karena memotong overhead 20x HTTP/TLS handshake dan menyatukan validasi kuota secara atomic.
- **Catatan Kalibrasi**: Kecepatan tidak akan murni 20x lipat karena di sisi server setiap file tetap harus melalui proses upload R2 dan pencatatan database; penghematan terbesar berasal dari eliminasi overhead jaringan, koneksi, dan validasi kuota berulang.
- **Kriteria Validasi**:
  - Total durasi pengiriman N gambar via `/api/scans/batch` lebih singkat dengan jumlah koneksi HTTP jauh lebih sedikit dibandingkan N kali request satuan (`single-loop`).
