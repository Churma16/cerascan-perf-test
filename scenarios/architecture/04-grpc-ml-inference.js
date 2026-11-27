import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const grpcInferenceDuration = new Trend('grpc_inference_time_ms');

/**
 * Architecture Benchmark 04: Pure gRPC ML Inference (Protobuf over HTTP/2)
 * Pasangan tanding 1-to-1 untuk: scenarios/baseline/04-grpc-rest-baseline.js
 *
 * Klaim yang dibuktikan:
 * Komunikasi langsung Express -> Python ML via gRPC (port 50051, HTTP/2 Protobuf biner)
 * lebih cepat dan stabil dibanding REST HTTP/1.1 multipart (FastAPI port 8000) tanpa
 * campur tangan variabel RabbitMQ/R2/DB.
 */
export const options = {
    scenarios: {
        grpc_direct_inference: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '15s', target: 5 },
                { duration: '45s', target: 15 },
                { duration: '15s', target: 0 }
            ]
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

    sleep(1);
}
