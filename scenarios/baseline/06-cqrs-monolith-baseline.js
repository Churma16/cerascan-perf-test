import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const monolithReadLatency = new Trend('monolith_read_latency_ms');
const monolithWriteLatency = new Trend('monolith_write_latency_ms');

/**
 * Baseline Benchmark 06: Monolithic MySQL Single-Table Read + Write (Tanpa CQRS)
 * Executor: constant-arrival-rate (40 Read RPS + 5 Write RPS local / 80 Read + 10 Write VPS)
 */
export const options = {
    scenarios: {
        monolith_heavy_reads: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 80 : 40,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 20,
            maxVUs: 60,
            exec: 'readMonolithFlow'
        },
        monolith_concurrent_writes: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 10 : 5,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 10,
            maxVUs: 20,
            exec: 'writeMonolithFlow'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        monolith_read_latency_ms: ['p(95)<150']
    }
};

export function setup() {
    return getAuthToken();
}

export function readMonolithFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.get(`${BASE_URL}/api/baseline/dashboard/monolith`, {
        headers: { ...authHeaders }
    });
    monolithReadLatency.add(res.timings.duration);

    check(res, {
        'baseline monolith read status 200': (r) => r.status === 200
    });
}

export function writeMonolithFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const payload = {
        image: http.file(sampleTileBinary, `monolith_write_${__VU}_${__ITER}.png`, 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: { ...authHeaders }
    });
    monolithWriteLatency.add(res.timings.duration);

    check(res, {
        'baseline monolith write accepted 202': (r) => r.status === 202
    });
}

export default function (data) {
    readMonolithFlow(data);
    writeMonolithFlow(data);
}
