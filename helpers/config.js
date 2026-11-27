export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const DEFAULT_CREDENTIALS = {
    email: __ENV.TEST_USER_EMAIL || 'admin@cerascan.com',
    password: __ENV.TEST_USER_PASSWORD || 'Password123!'
};

export const DEFAULT_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'k6-cerascan-benchmark/1.0'
};

// Maksimal 10 user sesuai data seed akun penguji (admin + tester2..tester10), default 1 jika lokal
export const USER_POOL_SIZE = Math.min(Math.max(1, parseInt(__ENV.USER_POOL_SIZE || '1', 10)), 10);

// Ukuran batch gambar untuk Case 08 (default 10 gambar per request)
export const BATCH_SIZE = Math.max(1, parseInt(__ENV.BATCH_SIZE || '10', 10));

// Deteksi profil eksekusi: 'local' (aman untuk laptop) vs 'vps' (skala penuh)
export const BENCH_PROFILE = __ENV.BENCH_PROFILE || (
    (BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1')) ? 'local' : 'vps'
);

/**
 * Memilih tahapan stages berdasarkan BENCH_PROFILE ('local' vs 'vps').
 */
export function selectStages(localStages, vpsStages) {
    return BENCH_PROFILE === 'vps' ? vpsStages : localStages;
}
