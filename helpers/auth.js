import http from 'k6/http';
import { check } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { BASE_URL, DEFAULT_CREDENTIALS, DEFAULT_HEADERS, JWT_SECRET, USER_POOL_SIZE } from './config.js';

let cachedAuth = null;
let cachedTokenPool = null;

function toBase64Url(str) {
    return encoding.b64encode(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Membuat token JWT secara instan untuk userId tertentu jika JWT_SECRET tersedia.
 */
export function createVirtualUserToken(userId = 1, role = 'user', secret = JWT_SECRET) {
    const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = toBase64Url(JSON.stringify({ id: userId, role: role, plan_id: 1 }));
    const message = `${header}.${payload}`;
    const sigBase64 = crypto.hmac('sha256', secret, message, 'base64');
    const sig = sigBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${message}.${sig}`;
}

/**
 * Mengambil autentikasi untuk Virtual User tertentu.
 * Memilih token dari data.tokens pool (setup) atau fallback ke virtual/single token.
 */
export function getUserAuth(vuNumber = 1, data = null) {
    if (data && data.tokens && data.tokens.length > 0) {
        const index = (vuNumber - 1) % data.tokens.length;
        return data.tokens[index];
    }
    if (data && data.token) {
        return { token: data.token, userId: data.userId || 1 };
    }
    const userId = ((vuNumber - 1) % USER_POOL_SIZE) + 1;
    const token = createVirtualUserToken(userId, 'user');
    return { token, userId };
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
 * Menguji konkurensi multi-tenant realistis tanpa perlu JWT_SECRET server.
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
            password: 'Password123!'
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
