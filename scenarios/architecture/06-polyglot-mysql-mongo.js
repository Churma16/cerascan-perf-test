import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const cqrsReadLatency = new Trend('cqrs_read_latency_ms');
const cqrsWriteLatency = new Trend('cqrs_write_latency_ms');

/**
 * Architecture Benchmark 06: CQRS & Polyglot Persistence (Concurrent Read + Write)
 * Executor: constant-arrival-rate (40 Read RPS + 5 Write RPS local / 80 Read + 10 Write VPS)
 */
export const options = {
    scenarios: {
        cqrs_heavy_reads: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 80 : 40,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 20,
            maxVUs: 60,
            exec: 'readQueryFlow'
        },
        cqrs_concurrent_writes: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 10 : 5,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 10,
            maxVUs: 20,
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
        headers: { ...authHeaders }
    });
    cqrsReadLatency.add(res.timings.duration);

    check(res, {
        'cqrs read dashboard kpi status 200': (r) => r.status === 200
    });
}

export function writeCommandFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const payload = {
        image: http.file(sampleTileBinary, `cqrs_write_${__VU}_${__ITER}.png`, 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: { ...authHeaders }
    });
    cqrsWriteLatency.add(res.timings.duration);

    check(res, {
        'cqrs write scan accepted 202': (r) => r.status === 202
    });
}

export default function (data) {
    readQueryFlow(data);
    writeCommandFlow(data);
}
