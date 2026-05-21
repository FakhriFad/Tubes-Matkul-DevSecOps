// Backend healthcheck — uses 127.0.0.1 explicitly.
'use strict';
const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 4000,
  path: '/health',
  method: 'GET',
  timeout: 8000,
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      const ok = json.status === 'ok';
      process.stderr.write(`healthcheck: ${body.trim()} → ${ok ? 'healthy' : 'unhealthy'}\n`);
      process.exit(ok ? 0 : 1);
    } catch {
      const ok = res.statusCode === 200;
      process.stderr.write(`healthcheck: HTTP ${res.statusCode} → ${ok ? 'healthy' : 'unhealthy'}\n`);
      process.exit(ok ? 0 : 1);
    }
  });
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
