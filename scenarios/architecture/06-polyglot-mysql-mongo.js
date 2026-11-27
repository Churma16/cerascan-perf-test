import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const cqrsReadLatency = new Trend('cqrs_read_latency_ms');
const cqrsWriteLatency = new Trend('cqrs_write_latency_ms');

/**
 * Architecture Benchmark 06: CQRS & Polyglot Persistence (Concurrent Read + Write)
 * Pasangan tanding 1-to-1 untuk: scenarios/baseline/06-cqrs-monolith-baseline.js
 *
 * Klaim yang dibuktikan:
 * Jalur Read (Query Handler -> Redis/MongoDB read-model) dan jalur Write (Command -> MySQL + RabbitMQ)
 * terisolasi penuh. Beban baca analitik tinggi tidak mengunci (table lock) transaksi tulis.
 */
export const options = {
    scenarios: {
        cqrs_heavy_reads: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 20 },
                { duration: '40s', target: 40 },
                { duration: '20s', target: 0 }
            ],
            exec: 'readQueryFlow'
        },
        cqrs_concurrent_writes: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 5 },
                { duration: '40s', target: 10 },
                { duration: '20s', target: 0 }
            ],
            exec: 'writeCommandFlow'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        cqrs_read_latency_ms: ['p(95)<150']
    }
};

export function setup() {
    return getAuthToken();
}

export function readQueryFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.get(`${BASE_URL}/api/dashboard/kpi`, {
        headers: {
            ...authHeaders
        }
    });
    cqrsReadLatency.add(res.timings.duration);

    check(res, {
        'cqrs read dashboard kpi status 200': (r) => r.status === 200
    });

    sleep(1);
}

export function writeCommandFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const payload = {
        image: http.file(sampleTileBinary, `cqrs_write_${__VU}_${__ITER}.png`, 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: {
            ...authHeaders
        }
    });
    cqrsWriteLatency.add(res.timings.duration);

    check(res, {
        'cqrs write scan accepted 202': (r) => r.status === 202
    });

    sleep(1);
}

export default function (data) {
    readQueryFlow(data);
    writeCommandFlow(data);
}
