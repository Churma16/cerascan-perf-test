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

    const success = check(res, {
        'auth login status is 200 or 201': (r) => [200, 201].includes(r.status),
        'auth login contains token': (r) => {
            try {
                const token = r.json('data.token') || r.json('token');
                return !!token;
            } catch {
                return false;
            }
        }
    });

    if (success) {
        try {
            const token = res.json('data.token') || res.json('token');
            const userId = res.json('data.user.id') || res.json('user.id') || 1;
            cachedAuth = { token, userId };
            return cachedAuth;
        } catch {
            return null;
        }
    }

    return null;
}

export function getAuthHeaders(token) {
    const rawToken = typeof token === 'object' && token !== null ? token.token : token;
    return {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${rawToken}`
    };
}
