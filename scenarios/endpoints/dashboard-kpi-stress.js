import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Single-Endpoint Stress Test: GET /api/dashboard/kpi
 * Karakteristik: Read-heavy, dilindungi Redis Caching Middleware.
 * Tujuan: Menguji ketahanan cache hit rate saat ribuan operator membuka dashboard bersamaan.
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
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<80', 'p(99)<250'] // p95 < 80ms pada cache hit
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

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
