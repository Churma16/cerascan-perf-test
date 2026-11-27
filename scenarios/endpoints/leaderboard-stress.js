import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../../helpers/config.js';

/**
 * Single-Endpoint Stress Test: GET /api/leaderboards
 * Karakteristik: Read-heavy, 100% in-memory Redis Sorted Set (ZREVRANGE), endpoint publik.
 * Tujuan: Menguji batas maksimal RPS Redis in-memory cache dan koneksi pool Express.
 */
export const options = {
    scenarios: {
        leaderboard_rps_ramp: {
            executor: 'ramping-arrival-rate',
            startRate: 50,
            timeUnit: '1s',
            preAllocatedVUs: 50,
            maxVUs: 1000, // Alokasi VU cukup untuk mencegah dropped iterations saat 1.000 RPS
            stages: [
                { duration: '30s', target: 200 }, // Naik ke 200 RPS
                { duration: '1m', target: 500 },  // Naik ke 500 RPS
                { duration: '1m', target: 1000 }, // Uji batas di 1.000 RPS
                { duration: '30s', target: 50 }   // Pendinginan
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],        // Maksimal error 1%
        http_req_duration: ['p(95)<50', 'p(99)<150'] // Redis in-memory harus sangat cepat: p95 < 50ms
    }
};

export default function () {
    const res = http.get(`${BASE_URL}/api/leaderboards`);

    check(res, {
        'leaderboard status is 200': (r) => r.status === 200,
        'leaderboard returns array': (r) => {
            try {
                const body = r.json();
                return Array.isArray(body) || Array.isArray(body.data);
            } catch {
                return false;
            }
        }
    });
}
