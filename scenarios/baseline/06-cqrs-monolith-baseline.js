import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL } from '../../helpers/config.js';
import { getAuthToken, getAuthHeaders } from '../../helpers/auth.js';

const sampleTileBinary = open('../../fixtures/images/sample-tile.png', 'b');
const monolithReadLatency = new Trend('monolith_read_latency_ms');
const monolithWriteLatency = new Trend('monolith_write_latency_ms');

/**
 * Baseline Benchmark 06: Monolithic MySQL Single-Table Read + Write (Tanpa CQRS)
 * Pasangan tanding 1-to-1 untuk: scenarios/architecture/06-polyglot-mysql-mongo.js
 *
 * Hipotesa:
 * Saat query agregasi KPI berat menghantam tabel transaksi aktif MySQL (scan_histories)
 * bersamaan dengan operasi INSERT scan baru, terjadi contention/lock yang memperlambat read & write.
 */
export const options = {
    scenarios: {
        monolith_heavy_reads: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 20 },
                { duration: '40s', target: 40 },
                { duration: '20s', target: 0 }
            ],
            exec: 'readMonolithFlow'
        },
        monolith_concurrent_writes: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '20s', target: 5 },
                { duration: '40s', target: 10 },
                { duration: '20s', target: 0 }
            ],
            exec: 'writeMonolithFlow'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'],
        monolith_read_latency_ms: ['p(95)<150']
    }
};

export function setup() {
    return getAuthToken();
}

export function readMonolithFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const res = http.get(`${BASE_URL}/api/baseline/dashboard/monolith`, {
        headers: {
            ...authHeaders
        }
    });
    monolithReadLatency.add(res.timings.duration);

    check(res, {
        'baseline monolith read status 200': (r) => r.status === 200
    });

    sleep(1);
}

export function writeMonolithFlow(data) {
    const authHeaders = getAuthHeaders(data && data.token);

    const payload = {
        image: http.file(sampleTileBinary, `monolith_write_${__VU}_${__ITER}.png`, 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: {
            ...authHeaders
        }
    });
    monolithWriteLatency.add(res.timings.duration);

    check(res, {
        'baseline monolith write accepted 202': (r) => r.status === 202
    });

    sleep(1);
}

export default function (data) {
    readMonolithFlow(data);
    writeMonolithFlow(data);
}
