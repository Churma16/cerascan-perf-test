import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthTokenPool, getUserAuth, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Single-Endpoint Stress Test: GET /api/dashboard/kpi
 * Karakteristik: Read-heavy, dilindungi Redis Caching Middleware per-user (`dashboard:kpi:${userId}`).
 * Beban: 300 concurrent VUs didistribusikan ke pool pengguna virtual (USER_POOL_SIZE)
 *        sehingga menguji konkurensi multi-tenant cache keys dan agregasi database.
 */
export const options = {
    scenarios: {
        dashboard_kpi_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 50 },
                { duration: '1m', target: 150 },
                { duration: '2m', target: 300 }, // 300 concurrent dashboard viewers
                { duration: '30s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<300', 'p(99)<800']
    }
};

export function setup() {
    const tokens = getAuthTokenPool();
    return { tokens };
}

export default function (data) {
    const auth = getUserAuth(__VU, data);
    if (!auth || !auth.token) {
        sleep(1);
        return;
    }

    const authHeaders = getAuthHeaders(auth.token);
    const res = http.get(`${BASE_URL}/api/dashboard/kpi`, { headers: authHeaders });

    check(res, {
        'dashboard kpi status is 200': (r) => r.status === 200,
        'dashboard kpi has data': (r) => {
            try {
                const body = r.json();
                return !!(body.data || body.total_scans !== undefined);
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
