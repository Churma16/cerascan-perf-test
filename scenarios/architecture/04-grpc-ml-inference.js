import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');
const grpcInferenceDuration = new Trend('grpc_inference_time_ms');

/**
 * Architecture Benchmark 04: Pure gRPC ML Inference (Protobuf over HTTP/2)
 * Pasangan tanding 1-to-1 untuk: scenarios/baseline/04-grpc-rest-baseline.js
 * Executor: constant-arrival-rate (exact Target RPS: 8 RPS local / 15 RPS vps)
 */
export const options = {
    scenarios: {
        grpc_direct_inference: {
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
        image: http.file(sampleTileBinary, 'grpc-direct-tile.png', 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/baseline/scans/grpc-inference`, payload, {
        headers: {
            ...authHeaders
        }
    });

    check(res, {
        'grpc direct inference status is 200': (r) => r.status === 200,
        'grpc returns prediction': (r) => {
            try {
                const body = r.json();
                if (body && body.data && typeof body.data.client_inference_time_ms === 'number') {
                    grpcInferenceDuration.add(body.data.client_inference_time_ms);
                }
                return body && body.data && !!body.data.prediction;
            } catch {
                return false;
            }
        }
    });
}
