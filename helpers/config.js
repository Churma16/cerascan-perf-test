export const BASE_URL = __ENV.BASE_URL || 'https://api-ceramic.churma.codes';

export const DEFAULT_CREDENTIALS = {
    email: __ENV.TEST_USER_EMAIL || 'admin@cerascan.com',
    password: __ENV.TEST_USER_PASSWORD || 'Password123!'
};

export const DEFAULT_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'k6-cerascan-benchmark/1.0'
};

export const JWT_SECRET = __ENV.JWT_SECRET || 'fallback_secret_key';
export const USER_POOL_SIZE = parseInt(__ENV.USER_POOL_SIZE || '10', 10);
