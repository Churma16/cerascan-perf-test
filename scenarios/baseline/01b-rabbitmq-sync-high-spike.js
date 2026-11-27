import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');

export const options = {
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    scenarios: {
        baseline_sync_high_spike: {
            executor: 'constant-arrival-rate',
            rate: 30,
            timeUnit: '1s',
            duration: '25s',
            preAllocatedVUs: 20,
            maxVUs: 60
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<1000']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);
    const payload = { image: http.file(sampleTileBinary, 'baseline-sync-spike.png', 'image/png') };
    const res = http.post(`${BASE_URL}/api/baseline/scans/sync`, payload, { headers: { ...authHeaders } });
    check(res, { 'baseline sync status is 200': (r) => r.status === 200 });
}
