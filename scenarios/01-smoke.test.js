import { sleep, check } from 'k6';
import http from 'k6/http';
import { BASE_URL } from '../helpers/config.js';
import { getAuthTokenPool, getUserAuth } from '../helpers/auth.js';
import { runInspectorJourney } from '../journeys/inspector.journey.js';
import { runMonitorJourney } from '../journeys/monitor.journey.js';
import { runBuyerJourney } from '../journeys/buyer.journey.js';

export const options = {
    vus: 5,
    duration: '30s',
    thresholds: {
        http_req_failed: ['rate<0.05'], // Error rate < 5%
        http_req_duration: ['p(95)<500'] // 95% request di bawah 500ms
    }
};

export function setup() {
    const tokens = getAuthTokenPool();
    return { tokens };
}

export default function (data) {
    // Health check gateway dasar
    const rootRes = http.get(`${BASE_URL}/`);
    check(rootRes, {
        'gateway root status is 200': (r) => r.status === 200
    });

    // Cek endpoint Prometheus metrics
    const metricsRes = http.get(`${BASE_URL}/metrics`);
    check(metricsRes, {
        'metrics endpoint status is 200': (r) => r.status === 200
    });

    const auth = getUserAuth(__VU, data);
    if (auth && auth.token) {
        runMonitorJourney(auth.token, auth.userId);
        sleep(1);
        runInspectorJourney(auth.token, auth.userId);
        sleep(1);
        runBuyerJourney(auth.token, auth.userId);
    }

    sleep(1);
}
