import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, BATCH_SIZE, selectStages } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');
const totalLoopBatchDuration = new Trend('single_loop_batch_total_ms');

/**
 * Baseline Benchmark 08: Client-Side Single Looping ke Production Endpoint (Tanpa Batch)
 * Pasangan tanding 1-to-1 untuk: scenarios/architecture/08-batch-multipart-ingest.js
 *
 * Hipotesa:
 * Mengirim BATCH_SIZE (default 10) gambar lewat looping request satuan ke POST /api/scans
 * memiliki total durasi lebih lambat dan overhead koneksi lebih tinggi dibanding 1 stream POST /api/scans/batch.
 */
export const options = {
    scenarios: {
        baseline_single_loop: {
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
        single_loop_batch_total_ms: ['p(95)<15000']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);
    const loopStartTime = Date.now();

    for (let i = 1; i <= BATCH_SIZE; i++) {
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
