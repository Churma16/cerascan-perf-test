import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Baseline Benchmark 07b: In-Process 3x Retry with Exponential Backoff
 * Pasangan tanding untuk: scenarios/architecture/07-dlq-fault-tolerance.js
 *
 * Mengukur penahanan thread request (latensi meningkat tajam karena retry loop)
 * dan hilangnya job jika proses crash sebelum/selama retry.
 */
export const options = {
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    scenarios: {
        baseline_retry_log: {
            executor: 'shared-iterations',
            vus: 5,
            iterations: 20,
            maxDuration: '30s'
        }
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.post(`${BASE_URL}/api/baseline/scans/retry-and-log`, JSON.stringify({ tile_id: "tile_err_01" }), {
        headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
        }
    });

    check(res, {
        'status is 200 after transient retry recovery': (r) => r.status === 200,
        'recovered at attempt 3': (r) => {
            try {
                const body = r.json();
                return body && body.data && body.data.attempts === 3;
            } catch {
                return false;
            }
        }
    });

    sleep(1);
}
