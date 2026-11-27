import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');

/**
 * Single-Endpoint Stress Test: POST /api/scans
 * Karakteristik: Compute & I/O Intensive (Multer RAM buffer -> R2 upload -> RabbitMQ publish).
 * Tujuan: Menguji titik jenuh buffer RAM Express, timeout upload R2, dan backpressure antrean RabbitMQ.
 */
export const options = {
    scenarios: {
        upload_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 20 },
                { duration: '1m', target: 50 },  // 50 concurrent image uploads
                { duration: '1m', target: 100 }, // 100 concurrent image uploads
                { duration: '30s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],         // Maksimal 5% gagal saat beban tinggi
        http_req_duration: ['p(95)<1500', 'p(99)<3000'] // Upload & broker publish di bawah 1.5s
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const payload = {
        image: http.file(sampleTileBinary, 'stress-tile.png', 'image/png')
    };

    const headers = getAuthHeaders(data && data.token);

    const res = http.post(`${BASE_URL}/api/scans`, payload, {
        headers
    });

    check(res, {
        'upload accepted status 200/201/202': (r) => [200, 201, 202].includes(r.status)
    });

    sleep(1);
}
