import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, USER_POOL_SIZE } from '../../helpers/config.js';

/**
 * Single-Endpoint Stress Test: GET /api/user-quotas/:user_id
 * Karakteristik: Endpoint validasi paling sering dipanggil (pre-flight setiap scan).
 * Beban: Menyebarkan request ke USER_POOL_SIZE ID pengguna untuk menguji index lookup MySQL
 *        dan menghindari bias InnoDB buffer pool dari single user ID.
 */
export const options = {
    scenarios: {
        quota_check_rps: {
            executor: 'constant-arrival-rate',
            rate: 300,        // Konstan 300 requests per detik
            timeUnit: '1s',
            duration: '2m',
            preAllocatedVUs: 100, // Little's Law buffer
            maxVUs: 500           // Cukup untuk menampung latensi hingga 1.6s tanpa dropped iterations
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<60', 'p(99)<200']
    }
};

export default function () {
    // Variasikan user_id 1..USER_POOL_SIZE berdasarkan Virtual User aktif
    const userId = ((__VU - 1) % USER_POOL_SIZE) + 1;
    const res = http.get(`${BASE_URL}/api/user-quotas/${userId}`);

    check(res, {
        'quota check status is 200': (r) => r.status === 200
    });
}
