// Frontend healthcheck — uses 127.0.0.1 explicitly to avoid
// localhost DNS issues in Alpine Linux containers.
'use strict';
const http = require('http');

const options = {
  hostname: '127.0.0.1',   // never use 'localhost' — DNS may resolve to ::1 in Alpine
  port: 3000,
  path: '/',
  method: 'GET',
  timeout: 8000,
};

const req = http.request(options, (res) => {
  // Accept any 2xx or 3xx as healthy
  const ok = res.statusCode >= 200 && res.statusCode < 400;
  process.stderr.write(`healthcheck: HTTP ${res.statusCode} → ${ok ? 'healthy' : 'unhealthy'}\n`);
  process.exit(ok ? 0 : 1);
});

req.on('timeout', () => {
  process.stderr.write('healthcheck: connection timed out\n');
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  process.stderr.write(`healthcheck: error ${err.code} — ${err.message}\n`);
  process.exit(1);
});

req.end();
