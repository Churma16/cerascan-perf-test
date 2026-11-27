import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const monolithReadLatency = new Trend('monolith_read_latency_ms');
const monolithWriteLatency = new Trend('monolith_write_latency_ms');

export const options = {
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    scenarios: {
        monolith_heavy_reads: {
            executor: 'constant-arrival-rate',
            rate: 250,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 40,
            maxVUs: 100,
            exec: 'readMonolithFlow'
        },
        monolith_concurrent_writes: {
            executor: 'constant-arrival-rate',
            rate: 15,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 15,
            maxVUs: 30,
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
    const res = http.get(`${BASE_URL}/api/baseline/dashboard/monolith`, { headers: { ...authHeaders } });
    monolithReadLatency.add(res.timings.duration);
    check(res, { 'baseline monolith read status 200': (r) => r.status === 200 });
}

export function writeMonolithFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);
    const payload = { image: http.file(sampleTileBinary, `monolith_write_${__VU}_${__ITER}.png`, 'image/png') };
    const res = http.post(`${BASE_URL}/api/scans`, payload, { headers: { ...authHeaders } });
    monolithWriteLatency.add(res.timings.duration);
    check(res, { 'baseline monolith write accepted 202': (r) => r.status === 202 });
}

export default function (data) {
    readMonolithFlow(data);
    writeMonolithFlow(data);
}
