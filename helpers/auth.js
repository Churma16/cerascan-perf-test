import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_CREDENTIALS, DEFAULT_HEADERS } from './config.js';

let cachedAuth = null;

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

export function getAuthHeaders(token) {
    const rawToken = typeof token === 'object' && token !== null ? token.token : token;
    return {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${rawToken}`
    };
}
