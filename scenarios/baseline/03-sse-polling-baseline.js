import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Baseline Benchmark 03: Short Polling Berkala (Tanpa SSE)
 * Pasangan tanding untuk: scenarios/architecture/03-sse-realtime-stream.js
 *
 * Hipotesa:
 * Short polling tiap 2 detik menghasilkan traffic amplification (banyak HTTP handshake
 * dan query database berulang) dibandingkan 1 koneksi SSE persisten yang idle.
 */
export const options = {
    scenarios: {
        baseline_short_polling: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 50 },
                { duration: '1m', target: 100 },
                { duration: '20s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    // Simulasi client polling status setiap 2 detik (7x dalam 14 detik, setara 1 window SSE 15s)
    for (let i = 0; i < 7; i++) {
        const res = http.get(`${BASE_URL}/api/baseline/scans/poll-status?scanId=latest`, {
            headers: {
                ...authHeaders
            }
        });

        check(res, {
            'poll request responded 200': (r) => r.status === 200
        });

        sleep(2);
    }
}
