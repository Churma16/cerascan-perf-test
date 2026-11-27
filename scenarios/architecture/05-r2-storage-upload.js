import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, selectStages } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');
const r2UploadLatency = new Trend('r2_upload_latency_ms');
const coreServiceImpactLatency = new Trend('core_service_impact_latency_ms');

/**
 * Architecture Benchmark 05: Cloudflare R2 Object Storage (Stateless & I/O Offload)
 * Pasangan tanding untuk: scenarios/baseline/05-r2-localdisk-baseline.js
 *
 * Metrik yang diukur (Dual-Latency + Disk Usage):
 * 1. r2_upload_latency_ms: Trade-off network hop saat upload ke Cloudflare R2.
 * 2. core_service_impact_latency_ms: Stabilitas latency endpoint inti (/api/user-quotas/me)
 *    saat beban upload berlangsung (membuktikan 0% gangguan Disk I/O lokal).
 */
export const options = {
    scenarios: {
        r2_upload_throughput: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: selectStages(
                [
                    { duration: '10s', target: 10 },
                    { duration: '20s', target: 20 },
                    { duration: '10s', target: 0 }
                ],
                [
                    { duration: '20s', target: 15 },
                    { duration: '40s', target: 35 },
                    { duration: '20s', target: 0 }
                ]
            )
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        core_service_impact_latency_ms: ['p(95)<100']
    }
};

export function setup() {
    return getAuthToken();
}

export default function (data) {
    const authHeaders = getAuthHeaders(data && data.token);

    // 1. Upload ke Cloudflare R2 via production scan flow
    const payload = {
        image: http.file(sampleTileBinary, `r2_bench_${__VU}_${__ITER}.png`, 'image/png')
    };

    const uploadRes = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: {
            ...authHeaders
        }
    });
    r2UploadLatency.add(uploadRes.timings.duration);

    check(uploadRes, {
        'r2 upload accepted status 202': (r) => r.status === 202
    });

    // 2. Cek dampak latency pada core endpoint lain di server yang sama
    const coreRes = http.get(`${BASE_URL}/api/user-quotas/me`, {
        headers: {
            ...authHeaders
        }
    });
    coreServiceImpactLatency.add(coreRes.timings.duration);

    check(coreRes, {
        'core service unaffected (200)': (r) => r.status === 200
    });

    sleep(1);
}
