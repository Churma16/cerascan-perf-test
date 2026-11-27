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
