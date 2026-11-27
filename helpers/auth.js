import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEFAULT_CREDENTIALS, DEFAULT_HEADERS } from './config.js';

let cachedToken = null;

export function getAuthToken(credentials = DEFAULT_CREDENTIALS) {
    if (cachedToken) {
        return cachedToken;
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
        'auth login status is 200': (r) => r.status === 200,
        'auth login contains token': (r) => {
            try {
                const body = JSON.parse(r.body);
                return !!(body.token || (body.data && body.data.token));
            } catch {
                return false;
            }
        }
    });

    if (success) {
        try {
            const body = JSON.parse(res.body);
            cachedToken = body.token || (body.data && body.data.token);
            return cachedToken;
        } catch {
            return null;
        }
    }

    return null;
}

export function getAuthHeaders(token) {
    return {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${token}`
    };
}
