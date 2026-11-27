import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Baseline Benchmark 02b: Direct DB Query (High-RPS Cranked Up, No Sleep)
 * Pasangan tanding untuk: scenarios/architecture/02b-redis-high-rps.js
 */
export const options = {
    scenarios: {
        nocache_high_rps: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '10s', target: 30 },
                { duration: '20s', target: 60 },
                { duration: '10s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<150']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.get(`${BASE_URL}/api/baseline/dashboard/no-cache`, {
        headers: {
            ...authHeaders
        }
    });

    check(res, {
        'nocache high-rps status is 200': (r) => r.status === 200
    });
}
