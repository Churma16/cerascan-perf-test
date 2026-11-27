import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../helpers/config.js';
import { getAuthHeaders } from '../helpers/auth.js';

export function runBuyerJourney(token) {
    const authHeaders = getAuthHeaders(token);

    // 1. Ambil daftar paket langganan
    const plansRes = http.get(`${BASE_URL}/api/plans`, { headers: authHeaders });
    check(plansRes, {
        'buyer: get plans returns 200': (r) => r.status === 200
    });

    sleep(1);

    // 2. Simulasi request checkout
    let planId = 1;
    try {
        const body = JSON.parse(plansRes.body);
        const plans = Array.isArray(body) ? body : (body.data || []);
        if (plans.length > 0 && plans[0].id) {
            planId = plans[0].id;
        }
    } catch {}

    const checkoutPayload = JSON.stringify({ planId });
    const checkoutRes = http.post(`${BASE_URL}/api/payment/checkout`, checkoutPayload, {
        headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
        }
    });

    check(checkoutRes, {
        'buyer: checkout returns 200/201/400': (r) => [200, 201, 400].includes(r.status)
    });

    sleep(2);

    // 3. Verifikasi ulang kuota
    const quotaRes = http.get(`${BASE_URL}/api/user-quotas/me`, { headers: authHeaders });
    check(quotaRes, {
        'buyer: verify quota returns 200': (r) => r.status === 200
    });
}
