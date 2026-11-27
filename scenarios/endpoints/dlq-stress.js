import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Single-Endpoint Stress Test: GET /api/dlq
 * Karakteristik: Management & Inspection for RabbitMQ Dead Letter Queue.
 * Menguji kecepatan inspeksi pesan dead-letter tanpa membebani broker RabbitMQ.
 */
export const options = {
    scenarios: {
        dlq_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '15s', target: 15 },
                { duration: '30s', target: 30 },
                { duration: '15s', target: 0 }
            ]
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

    const res = http.get(`${BASE_URL}/api/dlq`, { headers: authHeaders });

    check(res, {
        'dlq inspection status is 200': (r) => r.status === 200,
        'dlq returns payload': (r) => {
            try {
                const body = r.json();
                return body !== null;
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
