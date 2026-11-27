import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_CREDENTIALS, DEFAULT_HEADERS, USER_POOL_SIZE } from './config.js';

let cachedAuth = null;
let cachedTokenPool = null;

/**
 * Mengambil autentikasi untuk Virtual User tertentu.
 * Memilih token dari data.tokens pool (setup) atau fallback ke single auth token.
 */
export function getUserAuth(vuNumber = 1, data = null) {
    if (data && data.tokens && data.tokens.length > 0) {
        const vu = Math.max(1, vuNumber || 1);
        const index = (vu - 1) % data.tokens.length;
        return data.tokens[index];
    }
    if (data && data.token) {
        return { token: data.token, userId: data.userId || 1 };
    }
    return getAuthToken();
}

/**
 * Login akun default untuk single-user tests.
 */
export function getAuthToken(credentials = DEFAULT_CREDENTIALS) {
    if (cachedAuth) {
        return cachedAuth;
    }

    const payload = JSON.stringify({
        email: credentials.email,
        password: credentials.password
    });

    const res = http.post(`${BASE_URL}/api/auth/login`, payload, {
        headers: {
            ...DEFAULT_HEADERS,
            'Content-Type': 'application/json'
        }
    });

    const isSuccess = [200, 201].includes(res.status);
    let token = null;
    let userId = 1;

    if (isSuccess) {
        try {
            token = res.json('data.token') || res.json('token');
            userId = res.json('data.user.id') || res.json('user.id') || 1;
        } catch {
            token = null;
        }
    }

    check(res, {
        'auth login status is 200 or 201': () => isSuccess,
        'auth login contains token': () => !!token
    });

    if (!isSuccess || !token) {
        throw new Error(`Authentication setup failed (status ${res.status}): ${res.body}`);
    }

    cachedAuth = { token, userId };
    return cachedAuth;
}

/**
 * Mengambil pool token untuk USER_POOL_SIZE pengguna pada tahap setup().
 * Menguji konkurensi multi-tenant realistis tanpa Bcrypt storm pada loop VU.
 */
export function getAuthTokenPool(poolSize = USER_POOL_SIZE) {
    if (cachedTokenPool && cachedTokenPool.length >= poolSize) {
        return cachedTokenPool;
    }

    const tokens = [];

    // 1. Akun utama (admin@cerascan.com)
    try {
        const mainAuth = getAuthToken();
        if (mainAuth && mainAuth.token) {
            tokens.push({ token: mainAuth.token, userId: mainAuth.userId || 1 });
        }
    } catch (err) {
        // Lanjutkan mencoba akun tester jika akun utama gagal
    }

    // 2. Akun tester (tester2@cerascan.local s/d testerN)
    for (let i = 2; i <= poolSize; i++) {
        const payload = JSON.stringify({
            email: `tester${i}@cerascan.local`,
            password: DEFAULT_CREDENTIALS.password
        });

        const res = http.post(`${BASE_URL}/api/auth/login`, payload, {
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/json'
            }
        });

        if ([200, 201].includes(res.status)) {
            try {
                const token = res.json('data.token') || res.json('token');
                const userId = res.json('data.user.id') || res.json('user.id') || i;
                if (token) {
                    tokens.push({ token, userId });
                }
            } catch {}
        }
    }

    if (tokens.length === 0) {
        throw new Error('Gagal mendapatkan token autentikasi dari pool pengguna.');
    }

    cachedTokenPool = tokens;
    return cachedTokenPool;
}

export function getAuthHeaders(token) {
    const rawToken = typeof token === 'object' && token !== null ? token.token : token;
    return {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${rawToken}`
    };
}
