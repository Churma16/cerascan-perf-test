import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../helpers/config.js';
import { getAuthHeaders } from '../helpers/auth.js';

export function runBuyerJourney(token, userId = 1) {
    const authHeaders = getAuthHeaders(token);

    // 1. Ambil daftar paket langganan
    const plansRes = http.get(`${BASE_URL}/api/plans`, { headers: authHeaders });
    check(plansRes, {
        'buyer: get plans returns 200': (r) => r.status === 200
    });

    sleep(1);

    // 2. Simulasi request checkout (pilih paket berbayar agar valid di Midtrans)
    let planId = 2;
    try {
        const body = JSON.parse(plansRes.body);
        const plans = Array.isArray(body) ? body : (body.data || []);
        const paidPlan = plans.find((p) => Number(p.price) > 0);
        if (paidPlan && paidPlan.id) {
            planId = paidPlan.id;
        } else if (plans.length > 1 && plans[1].id) {
            planId = plans[1].id;
        }
    } catch {}

    const checkoutPayload = JSON.stringify({ plan_id: planId });
    const checkoutRes = http.post(`${BASE_URL}/api/payment/checkout`, checkoutPayload, {
        headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
        }
    });

    check(checkoutRes, {
        'buyer: checkout returns 200/201': (r) => [200, 201].includes(r.status)
    });

    sleep(2);

    // 3. Verifikasi ulang kuota
    const quotaRes = http.get(`${BASE_URL}/api/user-quotas/${userId}`, { headers: authHeaders });
    check(quotaRes, {
        'buyer: verify quota returns 200': (r) => r.status === 200
    });
}
