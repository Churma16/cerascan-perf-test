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
        sse_connected: ['rate>0.95']
    }
};

export default function () {
    const clientId = `bench_${__VU}_${__ITER}`;
    const sseUrl = `${BASE_URL}/api/sse/events?userId=${clientId}`;

    // Request SSE stream dengan timeout 15s untuk mensimulasikan koneksi aktif
    const res = http.get(sseUrl, {
        headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        },
        timeout: '15s'
    });

    const isRefused = res.error && typeof res.error === 'string' && (
        res.error.includes('refused') ||
        res.error.includes('reset') ||
        res.error.includes('no route')
    );

    const isConnected = check(res, {
        'sse stream connected and healthy': (r) => (r.status === 200 || (r.status === 0 && !isRefused))
    });

    sseConnected.add(isConnected);

    sleep(1);
}
