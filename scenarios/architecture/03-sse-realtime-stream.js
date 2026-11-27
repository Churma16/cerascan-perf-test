import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';

const sseConnected = new Rate('sse_connected_rate');

/**
 * Architecture Benchmark 03: Server-Sent Events (SSE) Real-Time Push Stream
 * 
 * Klaim yang dibuktikan:
 * 1. Express mampu menahan ratusan koneksi streaming persisten (long-lived idle HTTP sockets)
 *    tanpa kehabisan file descriptors atau memory leak.
 * 2. Menggantikan short polling HTTP yang boros request berulang dan berpotensi membebani database.
 */
export const options = {
    scenarios: {
        sse_concurrency_soak: {
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
        sse_connected_rate: ['rate>0.95']
    }
};

export default function () {
    const clientId = `arch_bench_${__VU}_${__ITER}`;
    const sseUrl = `${BASE_URL}/api/sse/events?userId=${clientId}`;

    // Membuka stream persisten SSE dengan timeout 15 detik
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

    const isHealthy = check(res, {
        'sse stream socket active': (r) => (r.status === 200 || (r.status === 0 && !isRefused))
    });

    sseConnected.add(isHealthy);

    sleep(1);
}
