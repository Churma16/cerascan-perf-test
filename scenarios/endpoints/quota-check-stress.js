import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Single-Endpoint Stress Test: GET /api/user-quotas/:user_id
 * Karakteristik: Endpoint validasi paling sering dipanggil (pre-flight setiap scan).
 * Tujuan: Memastikan query kuota di Redis/MySQL tidak menjadi bottleneck saat pabrik beroperasi penuh.
 */
export const options = {
    scenarios: {
        quota_check_rps: {
            executor: 'constant-arrival-rate',
            rate: 300,        // Konstan 300 requests per detik
            timeUnit: '1s',
            duration: '2m',
            preAllocatedVUs: 50,
            maxVUs: 150
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<60', 'p(99)<200']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const userId = (data && data.userId) || 1;
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.get(`${BASE_URL}/api/user-quotas/${userId}`, { headers: authHeaders });

    check(res, {
        'quota check status is 200': (r) => r.status === 200
    });
}
