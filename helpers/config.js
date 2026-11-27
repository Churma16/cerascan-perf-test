export const BASE_URL = __ENV.BASE_URL || 'https://ceramic.churma.codes';

export const DEFAULT_CREDENTIALS = {
    email: __ENV.TEST_USER_EMAIL || 'admin@cerascan.com',
    password: __ENV.TEST_USER_PASSWORD || 'Admin123!'
};

export const DEFAULT_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'k6-cerascan-benchmark/1.0'
};
