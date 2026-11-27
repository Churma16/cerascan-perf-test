import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, BATCH_SIZE, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');
const totalLoopBatchDuration = new Trend('single_loop_batch_total_ms');

/**
 * Baseline Benchmark 08: Client-Side Single Looping ke Production Endpoint (Tanpa Batch)
 * Executor: constant-arrival-rate (2 loop-set/s = 20 img/s local | 5 loop-set/s = 50 img/s vps)
 */
export const options = {
    scenarios: {
        baseline_single_loop: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 5 : 2,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 10,
            maxVUs: 30
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
            headers: { ...authHeaders }
        });

        check(res, {
            'baseline single loop scan accepted 202': (r) => r.status === 202
        });
    }

    totalLoopBatchDuration.add(Date.now() - loopStartTime);
}
