// Test de charge léger (k6): BASE_URL=https://afroeat-api-test.vercel.app k6 run scripts/load/smoke.k6.mjs
// Cible: p95 < 500 ms et < 1 % d'erreurs sur les endpoints publics. Ne jamais lancer contre la production sans accord.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:5000';

export default function () {
  const health = http.get(`${BASE}/health`);
  check(health, { 'health 200': (r) => r.status === 200 });
  const places = http.get(`${BASE}/api/restaurants`);
  check(places, { 'restaurants < 400': (r) => r.status < 400 });
  sleep(1);
}
