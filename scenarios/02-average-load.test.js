import { sleep } from 'k6';
import { getAuthToken } from '../helpers/auth.js';
import { runInspectorJourney } from '../journeys/inspector.journey.js';
import { runMonitorJourney } from '../journeys/monitor.journey.js';
import { runBuyerJourney } from '../journeys/buyer.journey.js';

export const options = {
    scenarios: {
        // 65% Factory Inspector Journey
        inspector_traffic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 20 },
                { duration: '3m', target: 65 },
                { duration: '1m', target: 0 }
            ],
            exec: 'inspectorScenario'
        },
        // 25% Plant Manager / Monitor Journey
        monitor_traffic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 10 },
                { duration: '3m', target: 25 },
                { duration: '1m', target: 0 }
            ],
            exec: 'monitorScenario'
        },
        // 10% Buyer / Top-up Journey
        buyer_traffic: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 5 },
                { duration: '3m', target: 10 },
                { duration: '1m', target: 0 }
            ],
            exec: 'buyerScenario'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.02'], // Error rate di bawah 2%
        http_req_duration: ['p(95)<300', 'p(99)<800'] // p95 < 300ms, p99 < 800ms
    }
};

export function setup() {
    return getAuthToken();
}

export function inspectorScenario(data) {
    if (data && data.token) {
        runInspectorJourney(data.token, data.userId);
    }
    sleep(2);
}

export function monitorScenario(data) {
    if (data && data.token) {
        runMonitorJourney(data.token, data.userId);
    }
    sleep(5);
}

export function buyerScenario(data) {
    if (data && data.token) {
        runBuyerJourney(data.token, data.userId);
    }
    sleep(10);
}
