import http from 'k6/http';
import { check } from 'k6';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';
import { BASE_URL, BATCH_SIZE, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');

/**
 * Architecture Benchmark 08: Batch Multipart Ingestion Pipeline
 * Executor: constant-arrival-rate (2 batch/s = 20 img/s local | 5 batch/s = 50 img/s vps)
 */
export const options = {
    scenarios: {
        batch_multipart_stress: {
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
}
