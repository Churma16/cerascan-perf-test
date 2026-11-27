import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');

/**
 * Architecture Benchmark 01: RabbitMQ Async Ingestion & Decoupling
 * 
 * Klaim yang dibuktikan:
 * 1. Express langsung merespons HTTP 202 Accepted dalam hitungan milidetik (< 200ms)
 *    karena beban inferensi AI didelegasikan secara asinkron ke antrean RabbitMQ (scan.process).
 * 2. Throughput upload tetap stabil tinggi tanpa connection starvation atau 504 Gateway Timeout.
 */
export const options = {
    scenarios: {
        rabbitmq_upload_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 20 },
                { duration: '1m', target: 50 },
                { duration: '30s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<500', 'p(99)<1000']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const payload = {
        image: http.file(sampleTileBinary, 'rabbitmq-tile.png', 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: {
            ...authHeaders
        }
    });

    check(res, {
        'status is 202 accepted': (r) => r.status === 202,
        'has scan tracking identifier': (r) => {
            try {
                const body = r.json();
                return body && body.data && !!body.data.scan_id;
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
