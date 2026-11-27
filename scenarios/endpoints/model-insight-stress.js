import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

/**
 * Single-Endpoint Stress Test: GET /api/model-insights/kpi & distributions
 * Karakteristik: CPU-bound MongoDB Aggregations & Analytics.
 * Menguji efisiensi pipeline agregasi analitik telemetri defect CeraScan di bawah beban tinggi.
 */
export const options = {
    scenarios: {
        insight_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 20 },
                { duration: '40s', target: 50 },
                { duration: '20s', target: 0 }
            ]
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<400']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    // 1. Model Insight KPI
    const kpiRes = http.get(`${BASE_URL}/api/model-insights/kpi`, { headers: authHeaders });
    check(kpiRes, {
        'model insight kpi status is 200': (r) => r.status === 200
    });

    // 2. Prediction distribution
    const distRes = http.get(`${BASE_URL}/api/model-insights/prediction-distribution`, { headers: authHeaders });
    check(distRes, {
        'prediction distribution status is 200': (r) => r.status === 200
    });

    sleep(1);
}
