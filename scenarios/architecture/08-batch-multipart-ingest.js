import http from 'k6/http';
import { check, sleep } from 'k6';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';
import { BASE_URL, BATCH_SIZE, selectStages } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');

/**
 * Architecture Benchmark 08: Batch Multipart Ingestion Pipeline
 *
 * Klaim yang dibuktikan:
 * 1. Mengunggah BATCH_SIZE (default 10) gambar dalam 1 stream multipart HTTP tunggal
 *    memotong overhead HTTP/TLS handshake & validasi kuota berulang dibanding client-side looping.
 */
export const options = {
    scenarios: {
        batch_multipart_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: selectStages(
                [
                    { duration: '10s', target: 5 },
                    { duration: '20s', target: 10 },
                    { duration: '10s', target: 0 }
                ],
                [
                    { duration: '20s', target: 10 },
                    { duration: '40s', target: 25 },
                    { duration: '20s', target: 0 }
                ]
            )
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<8000']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const fd = new FormData();
    for (let i = 1; i <= BATCH_SIZE; i++) {
        fd.append('images', http.file(sampleTileBinary, `tile_batch_${i}.png`, 'image/png'));
    }

    const res = http.post(`${BASE_URL}/api/scans/batch`, fd.body(), {
        headers: {
            ...authHeaders,
            'Content-Type': 'multipart/form-data; boundary=' + fd.boundary
        }
    });

    check(res, {
        'batch upload status is 202': (r) => r.status === 202,
        'batch items accepted': (r) => {
            try {
                const body = r.json();
                return body && body.meta && body.meta.code === 202 && Array.isArray(body.data) && body.data.length === BATCH_SIZE;
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
