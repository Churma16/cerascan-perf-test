import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, selectStages } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile-hd.png', 'b');
const localUploadLatency = new Trend('local_upload_latency_ms');
const localServingLatency = new Trend('local_serving_latency_ms');
const coreServiceImpactLatency = new Trend('core_service_impact_latency_ms');

/**
 * Baseline Benchmark 05: Local Disk Storage & Serving (Tanpa Cloudflare R2)
 * Pasangan tanding untuk: scenarios/architecture/05-r2-storage-upload.js
 *
 * Metrik yang diukur (Dual-Latency + Disk Usage):
 * 1. local_upload_latency_ms: Latency write ke SSD lokal.
 * 2. local_serving_latency_ms: Latency static file serving (/uploads/baseline/...) dari VPS.
 * 3. core_service_impact_latency_ms: Dampak beban Disk I/O & static serving terhadap
 *    latency endpoint inti (/api/user-quotas/me) pada server yang sama.
 */
export const options = {
    scenarios: {
        baseline_localdisk_upload: {
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

    // 1. Upload langsung ke disk lokal VPS
    const payload = {
        image: http.file(sampleTileBinary, `local_bench_${__VU}_${__ITER}.png`, 'image/png')
    };

    const uploadRes = http.post(`${BASE_URL}/api/baseline/scans/local-disk`, payload, {
        headers: {
            ...authHeaders
        }
    });
    localUploadLatency.add(uploadRes.timings.duration);

    let savedFileName = null;
    check(uploadRes, {
        'baseline local-disk status is 201': (r) => {
            if (r.status === 201) {
                try {
                    savedFileName = r.json('data.file_name');
                } catch {}
                return true;
            }
            return false;
        }
    });

    // 2. Simulasi user mengakses/mengunduh gambar langsung dari Express static /uploads
    if (savedFileName) {
        const serveRes = http.get(`${BASE_URL}/uploads/baseline/${savedFileName}`);
        localServingLatency.add(serveRes.timings.duration);

        check(serveRes, {
            'local static file served (200)': (r) => r.status === 200
        });
    }

    // 3. Cek dampak latency pada core endpoint lain di server yang sama
    const coreRes = http.get(`${BASE_URL}/api/user-quotas/me`, {
        headers: {
            ...authHeaders
        }
    });
    coreServiceImpactLatency.add(coreRes.timings.duration);

    check(coreRes, {
        'core service status 200': (r) => r.status === 200
    });

    sleep(1);
}
