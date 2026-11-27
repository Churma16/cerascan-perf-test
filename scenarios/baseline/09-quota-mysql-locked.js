import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    hot_user_quota_burst: {
      executor: 'constant-vus',
      vus: 60,
      duration: '20s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<150'],
  },
};

export function setup() {
  const res = http.post(
    `${BASE_URL}/api/baseline/quota/reset`,
    JSON.stringify({ userId: 1, totalQuota: 100000 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'quota reset ok': (r) => r.status === 200 });
}

export default function () {
  const res = http.post(
    `${BASE_URL}/api/baseline/quota/mysql-locked`,
    JSON.stringify({ userId: 1, amount: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
