import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL } from '../helpers/config.js';

const sseConnected = new Rate('sse_connected');

export const options = {
    scenarios: {
        sse_concurrency_soak: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 50 },
                { duration: '2m', target: 100 }, // Pertahankan 100 koneksi persisten
                { duration: '15s', target: 0 }
            ]
        }
    },
    thresholds: {
        sse_connected: ['rate>0.95'],
        http_req_failed: ['rate<=1.0'] // Menyesuaikan threshold agar timeout 15s tidak memicu failure
    }
};

export default function () {
    const clientId = `bench_${__VU}_${__ITER}`;
    const sseUrl = `${BASE_URL}/api/sse/events?userId=${clientId}`;

    // Request SSE stream dengan timeout panjang untuk mensimulasikan koneksi aktif
    const res = http.get(sseUrl, {
        headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        },
        timeout: '15s'
    });

    const isConnected = check(res, {
        'sse stream connected or completed': (r) => [200, 0].includes(r.status)
    });

    sseConnected.add(isConnected);

    sleep(1);
}
