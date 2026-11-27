import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../helpers/auth.js';

const sampleTileBinary = open('../fixtures/images/sample-tile.png', 'b');

export const options = {
    scenarios: {
        spike_upload: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '10s', target: 150 }, // Lonjakan cepat 150 VUs dalam 10 detik
                { duration: '1m', target: 150 },  // Tahan beban burst
                { duration: '15s', target: 0 }    // Pemulihan cepat
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'], // Maksimal error 5% saat burst
        http_req_duration: ['p(95)<1500'] // Upload & R2 roundtrip di bawah 1.5s
    }
};

export default function () {
    const token = getAuthToken();
    if (!token) {
        sleep(1);
        return;
    }

    const payload = {
        image: http.file(sampleTileBinary, 'burst-tile.png', 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/scans/analyze`, payload, {
        headers: getAuthHeaders(token)
    });

    check(res, {
        'spike: upload status is 200/201/202': (r) => [200, 201, 202].includes(r.status)
    });

    sleep(1);
}
