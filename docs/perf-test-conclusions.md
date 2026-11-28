# CeraScan Performance Test Conclusions & Architectural Trade-offs

- **Reference Report**: [perf-test-report.md](./perf-test-report.md)
- **Hypotheses Reference**: [performance-hypotheses.md](./performance-hypotheses.md)
- **Environment**: Local Benchmark (`http://localhost:3000`, `BENCH_PROFILE=local`)
- **Date**: 2026-11-28

---

## 1. Ringkasan Eksekutif: Crossover Point & Operational Tax

Dalam rekayasa perangkat lunak modern, arsitektur terdistribusi bukanlah "peluru perak" yang selalu lebih cepat di segala situasi. Setiap komponen terdistribusi membawa **operational tax** (overhead jaringan, serialisasi data, dan kompleksitas sinkronisasi).

Hasil pengujian komparatif komprehensif ini membuktikan:
1. **Di Bawah Crossover Point (< 50–100 RPS)**: Pendekatan sederhana (in-process cache, single-statement SQL, monolith ber-index) sering kali memiliki latensi yang setara atau bahkan sedikit lebih cepat dibanding sistem terdistribusi karena terbebas dari *network roundtrip* eksternal.
2. **Di Atas Crossover Point (> 100–250 RPS atau Lonjakan Spike)**: Pendekatan monolitik / in-process mengalami **degradasi eksponensial** akibat saturasi *connection pool*, *lock contention*, dan saturasi heap RAM V8. Pada titik inilah pilar terdistribusi CeraScan memberikan perlindungan stabilitas (*anti-crash*), throughput tinggi (*scale-out*), dan isolasi resource.

### Ringkasan Crossover RPS Tiap Pilar
| Pilar Arsitektur | Kapan Mulai *Worth It* (Crossover Point) | Alasan Teknis |
| :--- | :---: | :--- |
| **RabbitMQ Queue (`01b`)** | **> 15–20 RPS** Upload Spike | Direct Sync menghabiskan socket HTTP & VUs; In-Process Queue rawan OOM heap RAM. |
| **Redis In-Memory Cache (`02b`)** | **> 100–150 RPS** Read | Di bawah 100 RPS, MySQL buffer pool cukup cepat; di atas 150 RPS, agregasi DB membebani CPU. |
| **gRPC ML Inference (`04`)** | **Konstan (> 5 RPS)** pada gambar HD | HTTP/2 multiplexing & biner Protobuf menghemat 90% waktu serialisasi multipart. |
| **Cloudflare R2 Storage (`05`)** | **Bukan soal kecepatan, tapi skala** | Menulis SSD lokal lebih cepat, namun R2 menjaga backend **100% stateless** dan meng-offload 99.8% outbound bandwidth. |
| **CQRS & Polyglot (`06b`)** | **> 150 Read RPS + 15 Write RPS** | Mencegah query baca analitik menghabiskan connection pool MySQL yang dibutuhkan transaksi tulis. |
| **Dead Letter Queue (`07`)** | **Saat Downstream / Worker Gagal** | Menghindari thread request tertahan oleh synchronous retry loop (5x lebih lambat) dan mencegah kehilangan data saat server restart. |
| **Redis Atomic Quota (`09`)** | **> 80–100 RPS** Konkuren pada 1 Akun | Single-statement SQL mulai mengalami lock contention di atas 700 RPS; Write-Behind menembus **4.200+ RPS**. |

---

## 2. Kesimpulan Per Case (Dengan Baseline Tengah yang Fair)

---

### Case 01, 01b & 01b-mid — RabbitMQ vs In-Process Queue vs Direct Sync
- **Spektrum Pengujian**:
  - `base:01b` (Direct Sync, menahan koneksi HTTP hingga ML selesai)
  - `base:01b-mid` (In-Process Memory Queue, menyimpan job di array RAM Node.js & return 202)
  - `arch:01b` (RabbitMQ Message Broker + R2 Upload & return 202)
- **Hasil Metrik (Spike 30 RPS, 25s)**:
  - `base:01b` (Direct Sync): **Saturasi Kapasitas**. `7.76/s`, **`500` dropped iterations**, P95 `8.35s`, P99 `8.74s`, mencapai batas alokasi 60 VUs.
  - `base:01b-mid` (In-Process Queue): `29.96/s`, 0 dropped, Avg `1.99ms`, P95 `4.02ms`, P99 `6.12ms`.
  - `arch:01b` (RabbitMQ + R2): `29.39/s`, 0 dropped, Avg `343.67ms`, P95 `484.56ms`, P99 `755.29ms`.
- **Analisis & Trade-Off**:
  - Secara latensi HTTP murni, In-Process Queue (`base:01b-mid`) paling cepat karena hanya memasukkan buffer gambar ke memori V8 Node.js tanpa upload cloud atau publish broker.
  - **Kelemahan Fatal In-Process Queue**: Jika proses Node.js restart, crash, atau kehabisan memori (OOM), **100% antrean gambar di RAM hilang tanpa jejak**. Selain itu, memori heap Node.js membengkak seiring antrean bertambah.
  - **Nilai Nyata RabbitMQ**: Bukan sekadar membuat endpoint "asinkron 202", melainkan memberikan **durabilitas disk antrean**, isolasi memori server dari antrean gambar, dan kemampuan mendistribusikan beban ke banyak worker pod secara horizontal.

---

### Case 02, 02b & 02b-mid — Redis Cache vs In-Process Cache vs Direct DB
- **Spektrum Pengujian**:
  - `base:02b` (Direct DB Query, menghitung ulang KPI langsung dari MySQL)
  - `base:02b-mid` (In-Process Memory Cache, Map RAM lokal dengan TTL 60s)
  - `arch:02b` (Distributed Redis Cache)
- **Hasil Metrik (High-RPS Cranked, 60 VUs, no sleep)**:
  - `base:02b` (Direct DB): `272.28/s`, Avg `122.93ms`, P95 `211.65ms` (gagal threshold `<150ms`).
  - `arch:02b` (Redis Cache): `461.43/s`, Avg `72.37ms`, P95 `134.46ms` (lolos threshold), P99 `175.48ms`.
  - `base:02b-mid` (In-Process Cache): `2344.19/s`, Avg `14.08ms`, P95 `34.28ms`, P99 `47.52ms`.
- **Analisis & Trade-Off**:
  - Pada pengujian mesin tunggal (*single node*), In-Process Cache lokal 5x lebih cepat dibanding Redis karena membaca langsung dari heap pointer tanpa overhead socket TCP dan JSON serialization.
  - **Mengapa CeraScan Memilih Redis?**
    1. **Multi-Instance Cache Coherence**: Dalam deployment produksi dengan 3–10 pod Express di balik Load Balancer, cache in-process akan terfragmentasi (tiap pod punya data berbeda dan *cache invalidation* menjadi mimpi buruk).
    2. **Memory Footprint**: Redis memisahkan konsumsi RAM analitik dari heap V8 Node.js, mencegah GC (*Garbage Collection*) pauses yang dapat memicu spike latensi pada event loop Express.

---

### Case 04 — gRPC ML Inference vs REST HTTP/1.1 (Fair Match: 10 Workers + Keep-Alive)
- **Penyelarasan Fair Configuration**:
  - Sebelumnya, REST FastAPI berjalan pada 1 worker default tanpa keep-alive.
  - Pada pengujian ini, REST FastAPI diselaraskan dengan **10-thread concurrency pool** (sama persis dengan `ThreadPoolExecutor(max_workers=10)` pada gRPC) dan Express menggunakan `http.Agent({ keepAlive: true, maxSockets: 25 })`.
- **Hasil Metrik (8 RPS constant, 30s, Gambar HD ~618 KB)**:
  - `base:04` (REST 10w + KeepAlive): `6.21/s`, **`31` dropped iterations**, Avg `3.25s`, P95 `5.10s`, P99 `5.56s` (membaik dari 67 dropped & P95 5.92s).
  - `arch:04` (gRPC HTTP/2 Protobuf): `7.92/s`, **`0` dropped iterations**, Avg `398.38ms`, P95 `554.77ms`, P99 `594.95ms`.
- **Analisis**:
  - Penyelarasan thread pool dan keep-alive meningkatkan performa REST sekitar 25%, namun gRPC tetap **9.2x lebih cepat di P95** dan menghasilkan **0 dropped iterations** (vs 31 pada REST).
  - Keunggulan gRPC berasal dari **Protobuf binary serialization** (menghilangkan overhead parsing multipart MIME boundary yang memakan CPU pada gambar ratusan kilobyte) serta **HTTP/2 stream multiplexing** dalam 1 koneksi persisten.

---

### Case 05 — Cloudflare R2 vs Local Disk Storage (Statelessness vs Raw Write Speed)
- **Hasil Metrik (10 iter/s, 30s)**:
  - `base:05` (Local Disk): Upload Avg `12.69ms`, P95 `34.34ms`, namun disk lokal bertambah **`~190 MB`** dan Express menanggung **`190 MB` outbound static serving**.
  - `arch:05` (Cloudflare R2): Upload Avg `401.34ms`, P95 `644.47ms`, namun disk lokal **`0 MB`** dan outbound Express hanya **`355 kB` (-99.8%)**.
- **Analisis & Penegasan Trade-Off**:
  - Menulis file langsung ke NVMe/SSD lokal jelas lebih cepat daripada mengunggah via HTTPS ke Cloudflare R2 (`12ms` vs `401ms`). **CeraScan tidak menjual R2 sebagai percepatan latensi write**.
  - R2 digunakan murni untuk **Statelessness & Cost/Bandwidth Offload**: backend dapat di-restart, di-redeploy, dan di-scale secara dinamis tanpa risiko kehilangan file gambar lokal, sementara 99.8% beban serving static gambar dialihkan ke jaringan Cloudflare Edge global.

---

### Case 06, 06b & 06b-mid — CQRS & Polyglot vs Indexed Summary vs Monolith
- **Spektrum Pengujian (250 Read RPS + 15 Write RPS)**:
  - `base:06b` (Monolith live 4-table aggregation scan)
  - `base:06b-mid` (MySQL Indexed Summary Query — query terindeks tanpa CQRS)
  - `arch:06b` (CQRS Polyglot Read-Model: MongoDB / Redis)
- **Hasil Metrik**:
  - `base:06b` (Monolith Scan): Read Avg `626ms` / P95 `810ms`, Write Avg `1025ms`, Dropped **`2777`**.
  - `base:06b-mid` (Indexed Summary): Read Avg `612.2ms` / P95 `845.3ms`, Write Avg `868.2ms`, Dropped **`2701`**.
  - `arch:06b` (CQRS Polyglot): Read Avg **`51.1ms`** / P95 **`155ms`**, Write Avg **`377ms`**, Dropped **`25`**.
- **Analisis**:
  - Mengganti full-table scan menjadi query ringkas/terindeks (`base:06b-mid`) ternyata **belum menyelesaikan masalah** di beban 250 Read RPS. Mengapa?
  - Karena pembacaan dan penulisan **masih berebut koneksi dan CPU di engine MySQL yang sama** (`connection pool max: 20`). Saat ratusan query read masuk, transaksi write tetap harus mengantre.
  - CQRS memindahkan beban baca sepenuhnya ke MongoDB / Redis. MySQL hanya melayani 15 Write RPS, sehingga transaksi tulis turun dari ~1 detik menjadi 377ms.

---

### Case 07 & 07b-mid — Dead Letter Queue vs Synchronous 3x Retry
- **Spektrum Pengujian**:
  - `base:07` (Naive Fail-and-Forget, langsung throw 500)
  - `base:07b-mid` (In-Process Synchronous 3x Retry dengan backoff — penanganan transient failure)
  - `arch:07` (RabbitMQ Dead Letter Queue)
- **Hasil Metrik**:
  - `base:07` (Fail-and-Forget): Avg `4.68ms`, 100% data loss.
  - `base:07b-mid` (In-Process 3x Retry): Avg **`56.52ms`**, P95 **`60.96ms`**, Error **`0.00%`** (berhasil pulih pada percobaan ke-3).
  - `arch:07` (RabbitMQ DLQ): Avg **`10.85ms`**, P95 **`21.93ms`**, Error **`0.00%`** (0% data loss).
- **Analisis & Trade-Off**:
  - In-process retry (`base:07b-mid`) terbukti berhasil memulihkan kegagalan transient sehingga error rate mencapai 0.00%. Namun, ini menuntut bayaran mahal: **socket HTTP klien tersandera 5.2x lebih lama** (`56.52ms` vs `10.85ms`) karena klien harus menunggu seluruh siklus backoff (15ms + 30ms).
  - RabbitMQ DLQ memindahkan siklus retry ke background worker secara asinkron: endpoint langsung merespons klien dalam ~10ms.
  - Lebih jauh lagi, jika kegagalan bersifat permanen atau proses crash di tengah retry, in-process queue mengalami kehilangan data 100%, sedangkan RabbitMQ secara otomatis mengalirkan pesan ke antrean `scan.dlq` pada disk broker.

---

### Case 09, 09b & 09c — Spektrum Lengkap Quota Decrement
Pengujian ini adalah bukti paling komprehensif, menguji 4 tingkat arsitektur berbeda pada **Hot-User Burst (60 VUs, 20s, no sleep)**:

1. **`base:09` (MySQL Pessimistic Lock)**:
   - Pola: `BEGIN` -> `SELECT ... FOR UPDATE` -> `UPDATE` -> `COMMIT`
   - Metrik: **`127.45 RPS`**, Avg `463.70ms`, P95 `617.83ms`, P99 `727.87ms`.
   - Masalah: *Extreme lock contention* pada 1 baris record user.
2. **`base:09b` (MySQL Atomic Single-Statement SQL)**:
   - Pola: `UPDATE user_quotas SET used = used + 1 WHERE id = ? AND remaining >= 1`
   - Metrik: **`784.49 RPS`**, Avg `76.10ms`, P95 `100.73ms`, P99 `127.61ms`.
   - Analisis: **6.1x lebih cepat** dibanding naive `FOR UPDATE`, membuktikan kritik baseline sangat tepat.
3. **`base:09c` (Redis Atomic + Synchronous Write-Through)**:
   - Pola: Redis `decrBy()` -> langsung `UPDATE user_quotas` ke MySQL di request yang sama.
   - Metrik: **`701.58 RPS`**, Avg `85.16ms`, P95 `125.64ms`, P99 `146.47ms`.
   - Analisis: Sedikit lebih lambat dari `09b` karena menanggung *double penalty* (jaringan Redis + disk write MySQL).
4. **`arch:09` (Redis Atomic + Asynchronous Write-Behind CeraScan)**:
   - Pola: Redis `decrBy()` di memori RAM -> sinkronisasi berkala ke MySQL via cron / batch.
   - Metrik: **`4288.53 RPS`**, Avg `13.84ms`, P95 `23.45ms`, P99 `36.86ms`.
   - Analisis: **5.5x lebih cepat dari Atomic SQL** dan **6.1x lebih cepat dari Write-Through**, dengan P95 hanya 23ms.

#### Kesimpulan Kunci Case 09
Kecepatan 4.288 RPS pada CeraScan **bukan semata-mata karena memakai Redis**, melainkan karena **pemisahan penulisan relasional secara asinkron (Write-Behind)**. Jika Redis dipaksa menulis sinkron ke MySQL (Write-Through), kecepatannya jatuh kembali ke ~700 RPS.

---

## 3. Analisis Trade-off & Bukti Empiris Uji Chaos / Durabilitas

Hasil pengujian empiris menggunakan script `chaos/durability-chaos.test.mjs` (`npm run chaos:durability`) membuktikan secara kuantitatif batas ketahanan dan risiko arsitektur:

1. **Uji Durabilitas Antrean: In-Process RAM Queue vs RabbitMQ Broker (`Chaos 01`)**:
   - **Hasil Pengujian**: Saat 30 request upload diterima (HTTP 202) dan proses dipaksa berhenti mendadak (*SIGKILL/kill*):
     - **In-Process RAM Queue**: **100.0% data loss** (30/30 buffer gambar di heap V8 langsung musnah tanpa jejak).
     - **RabbitMQ Broker**: **0.00% data loss** (seluruh pesan tersimpan aman di disk log segment `ai_scan_worker_queue`, dan otomatis diproses ulang saat worker hidup kembali).
   - *Pelajaran Rekayasa*: Latensi in-process queue yang 2ms lebih cepat bukanlah keunggulan arsitektural yang dapat diandalkan untuk data bernilai tinggi (*high-value payload*).

2. **Pengukuran Jendela RPO pada Redis Write-Behind (`Chaos 02`)**:
   - **Hasil Pengujian**: Saat burst 50 pemotongan kuota dieksekusi cepat:
     - 50 decrement langsung terkonfirmasi di memori RAM Redis.
     - Sebelum cron sinkronisasi berkala berjalan, database MySQL masih mencatat saldo lama.
     - **Jendela Kerentanan (RPO Window)**: Maksimal sebesar interval sinkronisasi (default: 60 detik).
   - *Pelajaran Rekayasa*: Keunggulan throughput 4.288 RPS (+446% dibanding Atomic SQL) diperoleh dengan menerima trade-off *eventual consistency*.
   - *Mitigasi Wajib*: Mengaktifkan persistensi **Redis AOF (`appendonly yes`)** dengan `appendfsync everysec` di lingkungan produksi untuk mempersempit potensi kehilangan data maksimal menjadi 1 detik.

3. **Eventual Consistency Lag pada CQRS**:
   - Terdapat jeda beberapa milidetik antara transaksi write di MySQL dengan ketersediaan data di read-model MongoDB/Redis.
   - *Mitigasi*: Klien diarahkan untuk mendengarkan update status via SSE secara reaktif, bukan melakukan polling berulang ke database.

4. **Beban Operasional Komponen (Operational Tax)**:
   - Menjalankan 6 infrastruktur (MySQL, Redis, MongoDB, RabbitMQ, Kafka, Python gRPC) membutuhkan monitoring dan orkestrasi mandiri. Pada beban rendah (< 30 RPS), arsitektur monolith tunggal dengan MySQL ber-indeks sudah memadai. CeraScan baru benar-benar mutlak dibutuhkan saat memasuki fase pertumbuhan di atas 100 RPS atau lonjakan burst.

---

## 4. Rangkuman End-to-End User Journey

Pengujian User Journey gabungan (Auth, Dashboard, Upload R2 + RabbitMQ, Checkout, SSE) memvalidasi keandalan keseluruhan sistem:

- **Smoke Test (`5 VUs`, 30s)**: 100% PASS (`182/182` checks, P95 `392.29ms`, Err `0.00%`).
- **Average Load (`100 VUs`, 5m)**: 0.00% error pada `8.296` request, P99 `407.53ms` (lolos threshold `<800ms`), P95 `316.08ms` (karena 65% trafik upload R2).
- **Spike Upload (`150 VUs`, 1m25s)**: `8.101` upload diproses pada `93.91 RPS` dengan **0.00% error**, P95 `499.51ms` (3x lebih cepat dari batas 1.5s).
- **SSE Soak (`100` koneksi persisten, 2m45s)**: `100.00%` stream terhubung stabil tanpa kebocoran memori (`704/704` koneksi sukses).
