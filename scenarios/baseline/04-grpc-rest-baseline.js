import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');

/**
 * Baseline Benchmark 04: REST HTTP/1.1 Inference (Tanpa gRPC Protobuf)
 * Pasangan tanding untuk: scenarios/architecture/04-grpc-ml-inference.js
 * Executor: constant-arrival-rate (exact Target RPS: 8 RPS local / 15 RPS vps)
 */
export const options = {
    scenarios: {
        baseline_rest_inference: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 15 : 8,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 10,
            maxVUs: 30
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<600']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const payload = {
        image: http.file(sampleTileBinary, 'baseline-rest-tile.png', 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/baseline/scans/rest-inference`, payload, {
        headers: {
            ...authHeaders
        }
    });

    check(res, {
        'baseline rest inference status is 200': (r) => r.status === 200
    });
}
