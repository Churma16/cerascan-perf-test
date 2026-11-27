import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Baseline Benchmark 02: Direct Heavy DB Query (Tanpa Redis Cache)
 * Pasangan tanding untuk: scenarios/architecture/02-redis-caching-hotspot.js
 *
 * Hipotesa:
 * Tanpa Redis, setiap request memicu kalkulasi ulang langsung ke database (Disk I/O),
 * menyebabkan latency jauh lebih tinggi dan membebani connection pool DB.
 */
export const options = {
    scenarios: {
        baseline_nocache_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 30 },
                { duration: '1m', target: 80 },
                { duration: '20s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<100', 'p(99)<300']
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
        'baseline no-cache status is 200': (r) => r.status === 200
    });

    sleep(1);
}
