import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const totalLoopBatchDuration = new Trend('single_loop_3_images_total_ms');

/**
 * Baseline Benchmark 08: Client-Side Single Looping ke Production Endpoint (Tanpa Batch)
 * Pasangan tanding 1-to-1 untuk: scenarios/architecture/08-batch-multipart-ingest.js
 *
 * Hipotesa:
 * Mengirim 3 gambar lewat looping 3x request satuan ke POST /api/scans (mengerjakan beban
 * R2 + MySQL + RabbitMQ + cek kuota yang sama persis, namun 1-per-1) memiliki total durasi
 * lebih lambat dan overhead koneksi lebih tinggi dibanding 1 stream POST /api/scans/batch.
 */
export const options = {
    scenarios: {
        baseline_single_loop: {
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
        single_loop_3_images_total_ms: ['p(95)<3000']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);
    const loopStartTime = Date.now();

    // Mengirim 3 gambar satu per satu ke POST /api/scans (setara 3 gambar di POST /api/scans/batch)
    for (let i = 1; i <= 3; i++) {
        const payload = {
            image: http.file(sampleTileBinary, `loop_tile_${i}.png`, 'image/png')
        };

        const res = http.post(`${BASE_URL}/api/scans`, payload, {
            headers: {
                ...authHeaders
            }
        });

        check(res, {
            'baseline single loop scan accepted 202': (r) => r.status === 202
        });
    }

    totalLoopBatchDuration.add(Date.now() - loopStartTime);

    sleep(1);
}
