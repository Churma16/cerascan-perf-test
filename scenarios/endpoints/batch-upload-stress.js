import http from 'k6/http';
import { check, sleep } from 'k6';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');

/**
 * Single-Endpoint Stress Test: POST /api/scans/batch
 * Karakteristik: High-Throughput Batch Multipart Upload (Array images -> R2 upload -> RabbitMQ publish).
 * Menguji ketahanan memory Express dan throughput RabbitMQ saat menerima batch drop gambar dari lini produksi.
 */
export const options = {
    scenarios: {
        batch_upload_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 10 },
                { duration: '40s', target: 25 },
                { duration: '20s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<3000']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    // Mengirim 3 gambar per request dalam 1 batch multipart stream
    const fd = new FormData();
    fd.append('images', http.file(sampleTileBinary, 'tile_batch_1.png', 'image/png'));
    fd.append('images', http.file(sampleTileBinary, 'tile_batch_2.png', 'image/png'));
    fd.append('images', http.file(sampleTileBinary, 'tile_batch_3.png', 'image/png'));

    const res = http.post(`${BASE_URL}/api/scans/batch`, fd.body(), {
        headers: {
            ...authHeaders,
            'Content-Type': 'multipart/form-data; boundary=' + fd.boundary
        }
    });

    check(res, {
        'batch upload status is 202': (r) => r.status === 202,
        'batch upload returns payload items': (r) => {
            try {
                const body = r.json();
                return body && body.meta && body.meta.code === 202 && Array.isArray(body.data) && body.data.length === 3;
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
