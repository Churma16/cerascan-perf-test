import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Baseline Benchmark 07: Fail-and-Forget Error Handling (Tanpa DLQ)
 * Pasangan tanding untuk: scenarios/architecture/07-dlq-fault-tolerance.js
 *
 * Hipotesa:
 * Tanpa Dead Letter Queue, kegagalan worker langsung melempar HTTP 500 dan event hilang
 * permanen (100% data loss) tanpa mekanisme parkir atau retry.
 */
export const options = {
    scenarios: {
        baseline_fail_forget: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '15s', target: 10 },
                { duration: '30s', target: 30 },
                { duration: '15s', target: 0 }
            ]
        }
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.post(`${BASE_URL}/api/baseline/scans/fail-and-forget`, null, {
        headers: {
            ...authHeaders
        }
    });

    check(res, {
        'baseline fail-and-forget returns 500 (data lost)': (r) => r.status === 500
    });

    sleep(1);
}
