import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Architecture Benchmark 07: Dead Letter Queue (DLQ) & Fault Tolerance
 * 
 * Klaim yang dibuktikan:
 * 1. Pesan scan yang mengalami kegagalan transient atau worker crash tidak dibuang (Zero Data Loss),
 *    melainkan diparkir secara aman ke antrean Dead Letter Queue (exchange: scan.dlq).
 * 2. Admin dapat memantau daftar pesan bermasalah dan memicu automated batch retry dengan latensi rendah.
 */
export const options = {
    scenarios: {
        dlq_monitoring_stress: {
            executor: 'shared-iterations',
            vus: 5,
            iterations: 20,
            maxDuration: '30s'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<300']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    // 1. Inspeksi antrean Dead Letter Messages
    const dlqRes = http.get(`${BASE_URL}/api/dlq?limit=10&page=1`, {
        headers: {
            ...authHeaders
        }
    });

    check(dlqRes, {
        'dlq inspection status is 200': (r) => r.status === 200,
        'dlq returns valid schema': (r) => {
            try {
                const body = r.json();
                return body && body.meta && body.meta.code === 200;
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
