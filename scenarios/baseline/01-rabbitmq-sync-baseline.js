import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');

/**
 * Baseline Benchmark 01: Direct Synchronous Upload (Tanpa RabbitMQ)
 * Pasangan tanding untuk: scenarios/architecture/01-rabbitmq-async-upload.js
 *
 * Hipotesa:
 * Express menahan koneksi HTTP sambil menunggu inferensi AI selesai secara sinkron,
 * menyebabkan lonjakan latency, connection starvation, dan potensi OOM/timeout di bawah beban.
 */
export const options = {
    scenarios: {
        baseline_sync_upload: {
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
        image: http.file(sampleTileBinary, 'baseline-sync-tile.png', 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/baseline/scans/sync`, payload, {
        headers: {
            ...authHeaders
        }
    });

    check(res, {
        'baseline sync status is 200': (r) => r.status === 200
    });

    sleep(1);
}
