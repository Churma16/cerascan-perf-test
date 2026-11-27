import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../helpers/config.js';
import { getAuthHeaders } from '../helpers/auth.js';

const sampleTileBinary = open('../fixtures/images/sample-tile.png', 'b');

export function runInspectorJourney(token, userId = 1) {
    const authHeaders = getAuthHeaders(token);

    // 1. Cek kuota sebelum upload
    const quotaRes = http.get(`${BASE_URL}/api/user-quotas/${userId}`, { headers: authHeaders });
    check(quotaRes, {
        'inspector: quota check returns 200': (r) => r.status === 200
    });

    sleep(1);

    // 2. Upload scan gambar keramik (Multipart)
    const payload = {
        image: http.file(sampleTileBinary, 'sample-tile.png', 'image/png')
    };

    const uploadRes = http.post(`${BASE_URL}/api/scans`, payload, {
        headers: {
            ...authHeaders
        }
    });

    check(uploadRes, {
        'inspector: scan upload accepted (200/201/202)': (r) => [200, 201, 202].includes(r.status)
    });

    sleep(2);

    // 3. Ambil riwayat scan terbaru
    const historyRes = http.get(`${BASE_URL}/api/scans/history?limit=5`, { headers: authHeaders });
    check(historyRes, {
        'inspector: scan history returns 200': (r) => r.status === 200
    });
}
