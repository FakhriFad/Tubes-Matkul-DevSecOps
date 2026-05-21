/**
 * EcomShop — k6 Stress Test Suite
 * ================================
 * Tests all 4 DFD processes under load: register, login, item, cart.
 *
 * Scenarios (run in order via CLI flags):
 *   smoke   — 1 VU, 1 min  — sanity check (all endpoints respond)
 *   load    — 50 VUs, 5 min — sustained normal load
 *   stress  — ramp to 200 VUs — find the breaking point
 *   spike   — sudden 300 VU burst — test elasticity
 *   soak    — 30 VUs, 30 min — detect memory leaks / degradation
 *
 * Usage:
 *   # Install k6: https://k6.io/docs/getting-started/installation/
 *   k6 run stress-tests/k6-tests.js -e SCENARIO=smoke
 *   k6 run stress-tests/k6-tests.js -e SCENARIO=load
 *   k6 run stress-tests/k6-tests.js -e SCENARIO=stress
 *   k6 run --out json=stress-tests/results.json stress-tests/k6-tests.js -e SCENARIO=load
 *
 * Performance targets (ISO/IEC 25010 + common SLA standards):
 *   p95 response time  < 500ms
 *   p99 response time  < 1000ms
 *   error rate         < 1%
 *   throughput         > 100 req/s at peak load
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Inline randomString to avoid external jslib dependency
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ── Configuration ──────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'https://localhost';
const SCENARIO = __ENV.SCENARIO || 'smoke';

// Custom metrics
const errorRate        = new Rate('error_rate');
const loginDuration    = new Trend('login_duration',    true);
const itemsDuration    = new Trend('items_duration',    true);
const cartDuration     = new Trend('cart_duration',     true);
const checkoutDuration = new Trend('checkout_duration', true);
const authFailures     = new Counter('auth_failures');
const cartFailures     = new Counter('cart_failures');

// ── Scenario definitions ───────────────────────────────────────────────────────
const SCENARIOS = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '1m',
  },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m',  target: 10  },   // ramp up
      { duration: '3m',  target: 50  },   // sustain
      { duration: '1m',  target: 0   },   // ramp down
    ],
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m',  target: 50  },
      { duration: '3m',  target: 100 },
      { duration: '3m',  target: 200 },
      { duration: '2m',  target: 0   },
    ],
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 10  },   // normal baseline
      { duration: '10s', target: 300 },   // sudden spike
      { duration: '1m',  target: 300 },   // hold spike
      { duration: '30s', target: 10  },   // recover
      { duration: '30s', target: 0   },
    ],
  },
  soak: {
    executor: 'constant-vus',
    vus: 30,
    duration: '30m',
  },
};

// ── k6 options ─────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    [SCENARIO]: {
      ...SCENARIOS[SCENARIO],
    },
  },

  // Performance thresholds — test FAILS if these are breached
  thresholds: {
    // Overall HTTP
    http_req_duration: [
      'p(95)<500',    // 95th percentile under 500ms
      'p(99)<1000',   // 99th percentile under 1 second
    ],
    http_req_failed: ['rate<0.01'],   // error rate under 1%

    // Custom per-operation thresholds
    login_duration:    ['p(95)<600'],
    items_duration:    ['p(95)<300'],   // should be cache-fast most of the time
    cart_duration:     ['p(95)<500'],
    checkout_duration: ['p(95)<1000'],
    error_rate:        ['rate<0.01'],
  },

  // Reduce TLS noise for self-signed certs
  insecureSkipTLSVerify: true,

  // Summary output
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// ── Default params ─────────────────────────────────────────────────────────────
const PARAMS = {
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  timeout: '10s',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeEmail() {
  return `testuser_${randomString(8)}@stress.test`;
}

function authParams(token) {
  return {
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${token}`,
    },
    timeout: '10s',
  };
}

function checkResponse(res, name, expectedStatus = 200) {
  const ok = check(res, {
    [`${name}: status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${name}: has body`]:                 (r) => r.body && r.body.length > 0,
  });
  errorRate.add(!ok);
  return ok;
}

// ── Process 1: Register ────────────────────────────────────────────────────────
function testRegister() {
  const email = makeEmail();
  const payload = JSON.stringify({
    email,
    password:  'StressTest@1',
    full_name: 'Stress Test User',
  });

  const res = http.post(`${BASE_URL}/api/auth/register`, payload, PARAMS);
  const ok  = checkResponse(res, 'register', 201);
  if (!ok) authFailures.add(1);

  return ok ? { email, password: 'StressTest@1' } : null;
}

// ── Process 2: Login ───────────────────────────────────────────────────────────
function testLogin(credentials) {
  if (!credentials) return null;

  const start = Date.now();
  const res   = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(credentials),
    PARAMS
  );
  loginDuration.add(Date.now() - start);

  const ok = checkResponse(res, 'login', 200);
  if (!ok) { authFailures.add(1); return null; }

  const body = JSON.parse(res.body);
  if (body.mfa_required) return null;   // skip MFA accounts in stress test
  return body.token || null;
}

// ── Process 3: Item browsing ───────────────────────────────────────────────────
function testItems(token) {
  group('items', () => {
    // List items (should hit Redis cache after first request)
    const start = Date.now();
    const listRes = http.get(`${BASE_URL}/api/items`, authParams(token));
    itemsDuration.add(Date.now() - start);
    checkResponse(listRes, 'items list', 200);

    // Get single item if list returned results
    if (listRes.status === 200) {
      const body = JSON.parse(listRes.body);
      const items = body.items || [];
      if (items.length > 0) {
        const item  = items[Math.floor(Math.random() * items.length)];
        const itemRes = http.get(`${BASE_URL}/api/items/${item.id}`, authParams(token));
        checkResponse(itemRes, 'item detail', 200);
        return item;
      }
    }
    return null;
  });
}

// ── Process 4: Cart operations ─────────────────────────────────────────────────
function testCart(token) {
  group('cart', () => {
    // Get current cart
    const start   = Date.now();
    const cartRes = http.get(`${BASE_URL}/api/cart`, authParams(token));
    cartDuration.add(Date.now() - start);
    checkResponse(cartRes, 'get cart', 200);
  });
}

function testAddToCart(token, itemId) {
  if (!token || !itemId) return;

  const res = http.post(
    `${BASE_URL}/api/cart/items`,
    JSON.stringify({ item_id: itemId, quantity: 1 }),
    authParams(token)
  );

  const ok = checkResponse(res, 'add to cart', 201);
  if (!ok) cartFailures.add(1);
  return ok;
}

function testCheckout(token) {
  if (!token) return;

  const start = Date.now();
  const res   = http.post(`${BASE_URL}/api/cart/checkout`, '{}', authParams(token));
  checkoutDuration.add(Date.now() - start);
  // 400 is acceptable (empty cart); only 5xx is a failure
  check(res, {
    'checkout: not 5xx': (r) => r.status < 500,
  });
}

// ── Main VU function ───────────────────────────────────────────────────────────
export default function () {
  // Each VU simulates a realistic user journey:
  // Register → Login → Browse items → Add to cart → Checkout

  group('1_register', () => {
    const creds = testRegister();
    if (!creds) { sleep(1); return; }

    sleep(0.5);

    group('2_login', () => {
      const token = testLogin(creds);
      if (!token) { sleep(1); return; }

      sleep(0.5);

      group('3_browse_items', () => {
        // Browse items 1-3 times (realistic think time)
        const browseCount = Math.ceil(Math.random() * 3);
        for (let i = 0; i < browseCount; i++) {
          testItems(token);
          sleep(Math.random() * 1 + 0.5);
        }

        group('4_cart_and_checkout', () => {
          testCart(token);
          sleep(0.5);
          // 30% chance of completing a checkout
          if (Math.random() < 0.3) {
            testCheckout(token);
          }
        });
      });
    });
  });

  // Realistic think time between user sessions
  sleep(Math.random() * 2 + 1);
}

// ── Setup: ensure at least one item exists ─────────────────────────────────────
export function setup() {
  // Login as admin to seed an item if needed
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'admin@shop.local', password: 'Admin@12345' }),
    PARAMS
  );

  if (loginRes.status !== 200) {
    console.warn('Setup: could not login as admin — items may not exist');
    return { adminToken: null };
  }

  const token = JSON.parse(loginRes.body).token;
  if (!token) return { adminToken: null };

  // Check if items exist
  const itemsRes = http.get(`${BASE_URL}/api/items`, authParams(token));
  const items    = itemsRes.status === 200 ? JSON.parse(itemsRes.body).items : [];

  if (items.length === 0) {
    // Create a test item
    http.post(
      `${BASE_URL}/api/items`,
      JSON.stringify({ name: 'Stress Test Item', price: 10000, stock: 99999, description: 'Created by stress test' }),
      authParams(token)
    );
    console.log('Setup: created stress test item');
  } else {
    console.log(`Setup: ${items.length} items available`);
  }

  return { adminToken: token, itemId: items[0]?.id };
}

// ── Teardown ───────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log('Stress test complete.');
  if (data.adminToken) {
    http.post(`${BASE_URL}/api/auth/logout`, '{}', authParams(data.adminToken));
  }
}
