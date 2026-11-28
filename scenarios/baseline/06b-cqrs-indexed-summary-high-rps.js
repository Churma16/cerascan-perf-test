import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const indexedSummaryReadLatency = new Trend('indexed_summary_read_latency_ms');
const indexedSummaryWriteLatency = new Trend('indexed_summary_write_latency_ms');

export const options = {
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    scenarios: {
        indexed_summary_heavy_reads: {
            executor: 'constant-arrival-rate',
            rate: 250,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 40,
            maxVUs: 100,
            exec: 'readIndexedSummaryFlow'
        },
        indexed_summary_concurrent_writes: {
            executor: 'constant-arrival-rate',
            rate: 15,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 15,
            maxVUs: 30,
            exec: 'writeIndexedSummaryFlow'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        indexed_summary_read_latency_ms: ['p(95)<150']
    }
};

export function setup() {
    return getAuthToken();
}

export function readIndexedSummaryFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);
    const res = http.get(`${BASE_URL}/api/baseline/dashboard/indexed-summary`, { headers: { ...authHeaders } });
    indexedSummaryReadLatency.add(res.timings.duration);
    check(res, { 'baseline indexed summary read status 200': (r) => r.status === 200 });
}

export function writeIndexedSummaryFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);
    const payload = { image: http.file(sampleTileBinary, 'indexed-summary-tile.png', 'image/png') };
    const res = http.post(`${BASE_URL}/api/scans`, payload, { headers: { ...authHeaders } });
    indexedSummaryWriteLatency.add(res.timings.duration);
    check(res, { 'concurrent write status 202': (r) => r.status === 202 });
}
