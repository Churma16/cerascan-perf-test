import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, selectStages } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');

/**
 * Baseline Benchmark 04: REST HTTP/1.1 Inference (Tanpa gRPC Protobuf)
 * Pasangan tanding untuk: scenarios/architecture/04-grpc-ml-inference.js
 *
 * Hipotesa:
 * Pengiriman gambar via REST HTTP/1.1 multipart ke FastAPI memiliki overhead parsing teks/MIME
 * dan pembukaan koneksi baru yang lebih lambat dibanding gRPC Protobuf over HTTP/2.
 */
export const options = {
    scenarios: {
        baseline_rest_inference: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: selectStages(
                [
                    { duration: '10s', target: 5 },
                    { duration: '20s', target: 10 },
                    { duration: '10s', target: 0 }
                ],
                [
                    { duration: '15s', target: 5 },
                    { duration: '45s', target: 15 },
                    { duration: '15s', target: 0 }
                ]
            )
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

    sleep(1);
}
