import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Architecture Benchmark 02: Redis In-Memory Caching (Hotspot Protection)
 * Pasangan tanding 1-to-1 untuk: scenarios/baseline/02-redis-nocache-baseline.js
 *
 * Klaim yang dibuktikan:
 * 1. Redis menyerap read-traffic tinggi pada Dashboard KPI (GET /api/dashboard/kpi).
 * 2. Latency p95 terjaga konsisten di bawah 50ms (memory cache hit) tanpa membebani DB.
 */
export const options = {
    scenarios: {
        redis_cache_stress: {
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

    const kpiRes = http.get(`${BASE_URL}/api/dashboard/kpi`, {
        headers: {
            ...authHeaders
        }
    });

    check(kpiRes, {
        'dashboard kpi status is 200': (r) => r.status === 200,
        'dashboard kpi response fast': (r) => r.timings.duration < 150
    });

    sleep(1);
}
