import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../helpers/config.js';
import { getAuthHeaders } from '../helpers/auth.js';

export function runMonitorJourney(token) {
    const authHeaders = getAuthHeaders(token);

    // 1. Dashboard KPI
    const kpiRes = http.get(`${BASE_URL}/api/dashboard/kpi`, { headers: authHeaders });
    check(kpiRes, {
        'monitor: dashboard kpi returns 200': (r) => r.status === 200
    });

    sleep(1);

    // 2. Scan Trends
    const trendsRes = http.get(`${BASE_URL}/api/dashboard/scan-trends`, { headers: authHeaders });
    check(trendsRes, {
        'monitor: scan trends returns 200': (r) => r.status === 200
    });

    sleep(1);

    // 3. Model Insights KPI
    const insightRes = http.get(`${BASE_URL}/api/model-insights/kpi`, { headers: authHeaders });
    check(insightRes, {
        'monitor: model insights returns 200': (r) => r.status === 200
    });

    sleep(1);

    // 4. Monthly Leaderboard
    const leaderboardRes = http.get(`${BASE_URL}/api/leaderboards`, { headers: authHeaders });
    check(leaderboardRes, {
        'monitor: leaderboard returns 200': (r) => r.status === 200
    });
}
