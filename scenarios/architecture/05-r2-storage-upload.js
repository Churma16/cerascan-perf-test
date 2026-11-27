import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, BENCH_PROFILE } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');
const r2UploadLatency = new Trend('r2_upload_latency_ms');
const coreServiceImpactLatency = new Trend('core_service_impact_latency_ms');

/**
 * Architecture Benchmark 05: Cloudflare R2 Object Storage (Stateless & I/O Offload)
 * Executor: constant-arrival-rate (10 iter/s local / 25 iter/s vps)
 */
export const options = {
    scenarios: {
        r2_upload_throughput: {
            executor: 'constant-arrival-rate',
            rate: BENCH_PROFILE === 'vps' ? 25 : 10,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 15,
            maxVUs: 40
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
}
