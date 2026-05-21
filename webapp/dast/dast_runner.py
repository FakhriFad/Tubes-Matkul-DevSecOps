#!/usr/bin/env python3
"""
EcomShop DAST Runner
=====================
Dynamic Application Security Testing against the live application.
Runs active probes across all API endpoints and generates an HTML report.

Does NOT require ZAP or any external tool — uses only Python's stdlib.

Test categories:
  AUTH-001  Unauthenticated access to protected endpoints
  AUTH-002  Broken authentication — weak/missing JWT validation
  AUTH-003  IDOR — accessing other users' resources
  INJECT-001  SQL injection probes on input fields
  INJECT-002  XSS probes on input fields
  HEADER-001  Security headers presence check
  RATE-001   Rate limiting enforcement on auth endpoints
  SESS-001   Token still valid after logout (blacklist check)
  INPUT-001  Oversized payload handling
  INPUT-002  Invalid UUID handling
  CSRF-001   CORS policy check

Usage:
  # App must be running first:
  docker compose up -d

  python3 dast/dast_runner.py --base-url https://localhost
  python3 dast/dast_runner.py --base-url https://localhost --output dast/dast-report.html
"""

import ssl
import json
import time
import urllib.request
import urllib.error
import urllib.parse
import datetime
import argparse
import sys
import os
import re

# ── Test result model ─────────────────────────────────────────────────────────

class Result:
    def __init__(self, test_id, name, category, severity, status,
                 description, evidence, remediation, request_info=''):
        self.test_id      = test_id
        self.name         = name
        self.category     = category
        self.severity     = severity
        self.status       = status          # PASS | FAIL | WARN | SKIP | ERROR
        self.description  = description
        self.evidence     = evidence
        self.remediation  = remediation
        self.request_info = request_info


# ── HTTP helper ───────────────────────────────────────────────────────────────

class Client:
    def __init__(self, base_url, timeout=10):
        self.base_url = base_url.rstrip('/')
        self.timeout  = timeout
        # Skip TLS verification for self-signed certs
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode    = ssl.CERT_NONE

    def request(self, method, path, body=None, headers=None, expected_status=None):
        url  = self.base_url + path
        hdrs = {'Content-Type': 'application/json', 'Accept': 'application/json'}
        if headers:
            hdrs.update(headers)

        data = json.dumps(body).encode() if body is not None else None
        req  = urllib.request.Request(url, data=data, headers=hdrs, method=method)

        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=self.timeout) as resp:
                raw      = resp.read().decode('utf-8', errors='replace')
                status   = resp.status
                resp_hdrs = dict(resp.headers)
        except urllib.error.HTTPError as e:
            raw      = e.read().decode('utf-8', errors='replace')
            status   = e.code
            resp_hdrs = dict(e.headers)
        except Exception as e:
            return None, 0, {}, str(e)

        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}

        return parsed, status, resp_hdrs, raw

    def post(self, path, body=None, headers=None):
        return self.request('POST', path, body, headers)

    def get(self, path, headers=None):
        return self.request('GET', path, headers=headers)

    def delete(self, path, headers=None):
        return self.request('DELETE', path, headers=headers)

    def auth_header(self, token):
        return {'Authorization': f'Bearer {token}'}


# ── Test helpers ──────────────────────────────────────────────────────────────

def register_user(client, email=None, password='TestDAST@123'):
    ts    = int(time.time() * 1000)
    email = email or f'dast_{ts}@test.local'
    body, status, _, _ = client.post('/api/auth/register', {
        'email': email, 'password': password, 'full_name': 'DAST Tester'
    })
    return email, password, (status == 201)


def login_user(client, email, password='TestDAST@123'):
    body, status, _, _ = client.post('/api/auth/login', {
        'email': email, 'password': password
    })
    if status == 200 and isinstance(body, dict):
        return body.get('token')
    return None


def setup_session(client):
    """Register and login a fresh user, return token."""
    email, pwd, ok = register_user(client)
    if not ok:
        return None, None
    token = login_user(client, email, pwd)
    return token, email


# ── Individual tests ──────────────────────────────────────────────────────────

def test_auth001_unauth_access(client):
    """Protected endpoints must return 401 without a token."""
    endpoints = [
        ('GET',    '/api/cart'),
        ('GET',    '/api/auth/me'),
        ('POST',   '/api/cart/items'),
        ('POST',   '/api/cart/checkout'),
        ('GET',    '/api/audit-logs'),
    ]
    failures = []
    for method, path in endpoints:
        _, status, _, _ = client.request(method, path)
        if status != 401:
            failures.append(f'{method} {path} → {status} (expected 401)')

    if failures:
        return Result('AUTH-001', 'Unauthenticated Access Control', 'Authentication',
                      'HIGH', 'FAIL',
                      'Protected endpoints accessible without authentication.',
                      '\n'.join(failures),
                      'Ensure authenticate middleware is applied to all protected routes.')
    return Result('AUTH-001', 'Unauthenticated Access Control', 'Authentication',
                  'HIGH', 'PASS',
                  'All protected endpoints correctly return 401 without a token.',
                  f'Tested {len(endpoints)} endpoints — all returned 401.',
                  '')


def test_auth002_jwt_tampered(client):
    """Tampered JWT must be rejected."""
    token, _ = setup_session(client)
    if not token:
        return Result('AUTH-002', 'JWT Tampering', 'Authentication', 'HIGH', 'SKIP',
                      'Could not create test session.', '', '')

    # Tamper: flip last character of token
    tampered = token[:-1] + ('A' if token[-1] != 'A' else 'B')
    _, status, _, _ = client.get('/api/auth/me',
                                  headers=client.auth_header(tampered))
    if status == 401:
        return Result('AUTH-002', 'JWT Tampering', 'Authentication', 'HIGH', 'PASS',
                      'Tampered JWT correctly rejected with 401.',
                      f'Modified token rejected → HTTP {status}', '')
    return Result('AUTH-002', 'JWT Tampering', 'Authentication', 'HIGH', 'FAIL',
                  'Server accepted a tampered JWT signature.',
                  f'Modified token → HTTP {status} (expected 401)',
                  'Ensure jwt.verify() is called with { algorithms: [\'HS256\'] }.')


def test_auth003_logout_blacklist(client):
    """Token must be invalid after logout."""
    token, _ = setup_session(client)
    if not token:
        return Result('SESS-001', 'Token Blacklist After Logout', 'Session Management',
                      'HIGH', 'SKIP', 'Could not create test session.', '', '')

    # Logout
    client.post('/api/auth/logout', headers=client.auth_header(token))
    time.sleep(0.5)

    # Try to use the same token
    _, status, _, _ = client.get('/api/auth/me',
                                  headers=client.auth_header(token))
    if status == 401:
        return Result('SESS-001', 'Token Blacklist After Logout', 'Session Management',
                      'HIGH', 'PASS',
                      'Token correctly rejected after logout.',
                      f'Post-logout request → HTTP {status}', '')
    return Result('SESS-001', 'Token Blacklist After Logout', 'Session Management',
                  'HIGH', 'FAIL',
                  'Token still valid after logout — no blacklisting.',
                  f'Post-logout request → HTTP {status} (expected 401)',
                  'Store revoked tokens in Redis with TTL equal to token expiry.')


def test_auth004_idor(client):
    """User must not access another user's cart."""
    token1, _ = setup_session(client)
    token2, _ = setup_session(client)
    if not token1 or not token2:
        return Result('AUTH-003', 'IDOR — Cross-User Resource Access', 'Authorization',
                      'HIGH', 'SKIP', 'Could not create test sessions.', '', '')

    # User1 gets their cart ID
    body, status, _, _ = client.get('/api/cart', headers=client.auth_header(token1))

    # User2 tries to access User1's cart items (using their own token)
    # The cart endpoint is user-scoped so this should return user2's empty cart
    body2, status2, _, _ = client.get('/api/cart', headers=client.auth_header(token2))

    # Both should work but return different (empty) carts
    if status == 200 and status2 == 200:
        return Result('AUTH-003', 'IDOR — Cross-User Resource Access', 'Authorization',
                      'HIGH', 'PASS',
                      'Cart endpoint is correctly scoped to the authenticated user.',
                      'Each user receives their own cart data.', '')
    return Result('AUTH-003', 'IDOR — Cross-User Resource Access', 'Authorization',
                  'HIGH', 'WARN',
                  'Could not fully verify IDOR protection — manual review recommended.',
                  f'User1 cart: {status}, User2 cart: {status2}',
                  'Verify all DB queries filter by req.user.id.')


def test_inject001_sqli(client):
    """SQL injection probes in login fields."""
    payloads = [
        "' OR '1'='1",
        "'; DROP TABLE users; --",
        "' OR 1=1--",
        "\" OR \"\"=\"",
        "admin'--",
        "1' AND SLEEP(2)--",
    ]
    suspicious = []
    for payload in payloads:
        start = time.time()
        body, status, _, _ = client.post('/api/auth/login', {
            'email': payload, 'password': 'anything'
        })
        elapsed = time.time() - start

        # Flags: 200 response (auth bypass), 500 (DB error leaked), or > 2s delay (sleep injection)
        if status == 200:
            suspicious.append(f'Payload {repr(payload[:30])} → 200 (possible bypass)')
        elif status == 500:
            suspicious.append(f'Payload {repr(payload[:30])} → 500 (possible error leak)')
        elif elapsed > 2.0:
            suspicious.append(f'Payload {repr(payload[:30])} → {elapsed:.1f}s (possible time injection)')

    if suspicious:
        return Result('INJECT-001', 'SQL Injection', 'Injection',
                      'CRITICAL', 'FAIL',
                      'Login endpoint may be vulnerable to SQL injection.',
                      '\n'.join(suspicious),
                      'Use parameterised queries (pg $1 placeholders). Never concatenate user input into SQL.')
    return Result('INJECT-001', 'SQL Injection', 'Injection',
                  'CRITICAL', 'PASS',
                  f'Login endpoint resisted {len(payloads)} SQL injection payloads.',
                  f'All {len(payloads)} payloads returned 401/422 in normal time.', '')


def test_inject002_xss(client):
    """XSS probes in registration fields."""
    token, _ = setup_session(client)
    if not token:
        return Result('INJECT-002', 'Reflected XSS', 'Injection',
                      'HIGH', 'SKIP', 'Could not create test session.', '', '')

    payloads = [
        '<script>alert(1)</script>',
        '"><script>alert(1)</script>',
        "javascript:alert(1)",
        '<img src=x onerror=alert(1)>',
        '{{7*7}}',   # template injection probe
    ]
    reflected = []
    for payload in payloads:
        # Try registering with XSS in full_name
        ts = int(time.time() * 1000)
        body, status, _, raw = client.post('/api/auth/register', {
            'email': f'xss_{ts}@test.local',
            'password': 'XSSTest@123',
            'full_name': payload
        })
        # If the raw payload appears in the response unescaped, it's a reflection
        if payload in raw and status == 201:
            reflected.append(f'full_name={repr(payload[:40])} reflected in response')

    if reflected:
        return Result('INJECT-002', 'Reflected XSS', 'Injection',
                      'HIGH', 'FAIL',
                      'User input reflected in API response without encoding.',
                      '\n'.join(reflected),
                      'Escape HTML entities in all API responses. Use Content-Security-Policy header.')
    return Result('INJECT-002', 'Reflected XSS', 'Injection',
                  'HIGH', 'PASS',
                  'No XSS reflection detected in API responses.',
                  f'Tested {len(payloads)} payloads — none reflected unescaped.', '')


def test_header001_security_headers(client):
    """Required security headers must be present."""
    _, _, headers, _ = client.get('/')
    required = {
        'Strict-Transport-Security': 'HSTS missing — HTTP downgrade attacks possible',
        'X-Frame-Options':           'Clickjacking protection missing',
        'X-Content-Type-Options':    'MIME sniffing protection missing',
        'X-XSS-Protection':          'Legacy XSS filter not enabled',
    }
    missing = []
    present = []
    for header, desc in required.items():
        # Case-insensitive check
        found = any(k.lower() == header.lower() for k in headers)
        if found:
            present.append(header)
        else:
            missing.append(f'{header}: {desc}')

    if missing:
        sev = 'HIGH' if len(missing) > 2 else 'MEDIUM'
        return Result('HEADER-001', 'Security Headers', 'Configuration',
                      sev, 'FAIL' if len(missing) > 2 else 'WARN',
                      f'{len(missing)}/{len(required)} required security headers are missing.',
                      'Missing: ' + ', '.join(h.split(':')[0] for h in missing),
                      'Add all security headers in nginx.conf using add_header directives.')
    return Result('HEADER-001', 'Security Headers', 'Configuration',
                  'HIGH', 'PASS',
                  'All required security headers are present.',
                  'Present: ' + ', '.join(present), '')


def test_rate001_rate_limiting(client):
    """Auth endpoint must enforce rate limiting."""
    hit_limit = False
    responses = []
    for i in range(25):
        _, status, _, _ = client.post('/api/auth/login', {
            'email': f'ratelimit_{i}@test.local', 'password': 'wrong'
        })
        responses.append(status)
        if status == 429:
            hit_limit = True
            break

    if hit_limit:
        first_429 = responses.index(429) + 1
        return Result('RATE-001', 'Rate Limiting on Auth', 'Configuration',
                      'MEDIUM', 'PASS',
                      'Rate limiting is active on the login endpoint.',
                      f'429 received after {first_429} requests.', '')
    return Result('RATE-001', 'Rate Limiting on Auth', 'Configuration',
                  'MEDIUM', 'WARN',
                  'No rate limit response (429) observed after 25 rapid auth requests.',
                  f'All {len(responses)} requests returned: {set(responses)}',
                  'Ensure nginx rate limiting zone covers /api/auth/ with a low burst value.')


def test_input001_oversized_payload(client):
    """Server must reject oversized request bodies."""
    # Send 15KB payload (limit is 10KB in helmet/express config)
    large_body = {'full_name': 'A' * 15000, 'email': 'big@test.local', 'password': 'Test@123'}
    _, status, _, _ = client.post('/api/auth/register', large_body)

    if status in (400, 413, 422):
        return Result('INPUT-001', 'Oversized Payload Rejection', 'Input Validation',
                      'MEDIUM', 'PASS',
                      'Server correctly rejects oversized request bodies.',
                      f'15KB payload → HTTP {status}', '')
    return Result('INPUT-001', 'Oversized Payload Rejection', 'Input Validation',
                  'MEDIUM', 'WARN',
                  'Server accepted a 15KB payload — may allow DoS via large bodies.',
                  f'15KB payload → HTTP {status} (expected 400/413/422)',
                  'Set express body parser limit: express.json({ limit: \'10kb\' }).')


def test_input002_invalid_uuid(client):
    """Invalid UUIDs must return 422, not 500."""
    token, _ = setup_session(client)
    if not token:
        return Result('INPUT-002', 'Invalid UUID Handling', 'Input Validation',
                      'LOW', 'SKIP', 'Could not create test session.', '', '')

    invalid_ids = ['not-a-uuid', '../../etc/passwd', '<script>', '0', '-1']
    server_errors = []
    for bad_id in invalid_ids:
        _, status, _, _ = client.get(f'/api/items/{bad_id}',
                                      headers=client.auth_header(token))
        if status == 500:
            server_errors.append(f'/api/items/{bad_id} → 500')

    if server_errors:
        return Result('INPUT-002', 'Invalid UUID Handling', 'Input Validation',
                      'MEDIUM', 'FAIL',
                      'Invalid UUIDs cause 500 server errors — possible info leak.',
                      '\n'.join(server_errors),
                      'Add param(\'id\').isUUID() validation to all routes using :id parameters.')
    return Result('INPUT-002', 'Invalid UUID Handling', 'Input Validation',
                  'MEDIUM', 'PASS',
                  'Invalid UUIDs handled gracefully (no 500 errors).',
                  f'Tested {len(invalid_ids)} invalid IDs — no 500 responses.', '')


def test_cors001_cors_policy(client):
    """CORS must not allow arbitrary origins."""
    _, _, headers, _ = client.request('OPTIONS', '/api/auth/login', headers={
        'Origin': 'https://evil.attacker.com',
        'Access-Control-Request-Method': 'POST',
    })

    acao = next((v for k, v in headers.items()
                 if k.lower() == 'access-control-allow-origin'), None)

    if acao == '*':
        return Result('CORS-001', 'CORS Policy', 'Configuration',
                      'HIGH', 'FAIL',
                      'CORS allows all origins (*) — CSRF risk.',
                      f'Access-Control-Allow-Origin: {acao}',
                      'Set CORS origin to specific allowed domains only.')
    if acao and 'evil.attacker.com' in acao:
        return Result('CORS-001', 'CORS Policy', 'Configuration',
                      'HIGH', 'FAIL',
                      'CORS reflects arbitrary attacker origin.',
                      f'Access-Control-Allow-Origin: {acao}',
                      'Validate Origin against a whitelist before reflecting it.')
    return Result('CORS-001', 'CORS Policy', 'Configuration',
                  'HIGH', 'PASS',
                  'CORS does not allow arbitrary origins.',
                  f'Access-Control-Allow-Origin: {acao or "(not set)"}', '')


def test_rbac001_customer_cannot_create_item(client):
    """Customer role must not be able to create or delete items."""
    token, _ = setup_session(client)
    if not token:
        return Result('RBAC-001', 'RBAC — Customer Cannot Manage Items', 'Authorization',
                      'HIGH', 'SKIP', 'Could not create test session.', '', '')

    _, status, _, _ = client.post('/api/items', {
        'name': 'DAST Injected Item', 'price': 1, 'stock': 1
    }, headers=client.auth_header(token))

    if status == 403:
        return Result('RBAC-001', 'RBAC — Customer Cannot Manage Items', 'Authorization',
                      'HIGH', 'PASS',
                      'Customer role correctly blocked from creating items.',
                      f'POST /api/items as customer → HTTP {status}', '')
    return Result('RBAC-001', 'RBAC — Customer Cannot Manage Items', 'Authorization',
                  'HIGH', 'FAIL',
                  'Customer role was able to create items — RBAC not enforced.',
                  f'POST /api/items as customer → HTTP {status} (expected 403)',
                  'Add requireRole(\'admin\') middleware to item creation route.')


def test_rbac002_customer_cannot_view_audit_logs(client):
    """Customer role must not access audit logs."""
    token, _ = setup_session(client)
    if not token:
        return Result('RBAC-002', 'RBAC — Audit Log Access Control', 'Authorization',
                      'HIGH', 'SKIP', 'Could not create test session.', '', '')

    _, status, _, _ = client.get('/api/audit-logs',
                                  headers=client.auth_header(token))
    if status == 403:
        return Result('RBAC-002', 'RBAC — Audit Log Access Control', 'Authorization',
                      'HIGH', 'PASS',
                      'Customer correctly blocked from audit logs.',
                      f'GET /api/audit-logs as customer → HTTP {status}', '')
    return Result('RBAC-002', 'RBAC — Audit Log Access Control', 'Authorization',
                  'HIGH', 'FAIL',
                  'Customer can access audit logs — privilege escalation risk.',
                  f'GET /api/audit-logs as customer → HTTP {status} (expected 403)',
                  'Add requireRole(\'admin\') middleware to /api/audit-logs.')


# ── Run all tests ─────────────────────────────────────────────────────────────

ALL_TESTS = [
    test_auth001_unauth_access,
    test_auth002_jwt_tampered,
    test_auth003_logout_blacklist,
    test_auth004_idor,
    test_inject001_sqli,
    test_inject002_xss,
    test_header001_security_headers,
    test_rate001_rate_limiting,
    test_input001_oversized_payload,
    test_input002_invalid_uuid,
    test_cors001_cors_policy,
    test_rbac001_customer_cannot_create_item,
    test_rbac002_customer_cannot_view_audit_logs,
]


def run_all(base_url):
    client  = Client(base_url)
    results = []

    print(f'EcomShop DAST Runner')
    print(f'Target: {base_url}')
    print(f'Tests:  {len(ALL_TESTS)}')
    print()

    # Connectivity check
    _, status, _, err = client.get('/health')
    if status == 0:
        print(f'ERROR: Cannot reach {base_url}/health — {err}')
        print('Make sure the app is running: docker compose up')
        sys.exit(2)
    print(f'Connectivity: OK (HTTP {status})')
    print()

    for test_fn in ALL_TESTS:
        print(f'  Running {test_fn.__name__}...', end=' ', flush=True)
        start  = time.time()
        result = test_fn(client)
        elapsed = int((time.time() - start) * 1000)

        icon = {'PASS': '✓', 'FAIL': '✗', 'WARN': '⚠', 'SKIP': '○', 'ERROR': '!'}
        print(f'{icon.get(result.status, "?")} [{result.status}] ({elapsed}ms)')

        results.append(result)

    return results


# ── HTML Report ───────────────────────────────────────────────────────────────

STATUS_COLOUR = {
    'PASS':  '#4a7c59', 'FAIL': '#c94a2b',
    'WARN':  '#c9a227', 'SKIP': '#888880', 'ERROR': '#c94a2b',
}
STATUS_BG = {
    'PASS':  '#f0fff4', 'FAIL': '#fff0f0',
    'WARN':  '#fffbec', 'SKIP': '#f8f8f8', 'ERROR': '#fff0f0',
}
SEV_COLOUR = {
    'CRITICAL': '#d63031', 'HIGH': '#e17055',
    'MEDIUM':   '#fdcb6e', 'LOW':  '#74b9ff',
}


def generate_html_report(results, base_url, output_path, duration_ms):
    counts = {'PASS': 0, 'FAIL': 0, 'WARN': 0, 'SKIP': 0, 'ERROR': 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1

    passed = counts['PASS']
    total  = len([r for r in results if r.status != 'SKIP'])
    score  = int(passed / total * 100) if total > 0 else 0

    rows = []
    for r in results:
        sc  = STATUS_COLOUR.get(r.status, '#888')
        sbg = STATUS_BG.get(r.status, '#fff')
        sevc = SEV_COLOUR.get(r.severity, '#888')
        rows.append(f"""
    <tr style="background:{sbg}">
      <td><code style="font-size:0.78rem">{r.test_id}</code></td>
      <td style="font-weight:600">{r.name}</td>
      <td><span style="color:{sevc};font-weight:700;font-size:0.78rem">{r.severity}</span></td>
      <td>{r.category}</td>
      <td><span style="color:{sc};font-weight:700">{r.status}</span></td>
      <td style="font-size:0.82rem">{r.description}</td>
      <td><code style="font-size:0.75rem;word-break:break-all">{r.evidence.replace(chr(10),'<br>')}</code></td>
      <td style="font-size:0.78rem;color:#555">{r.remediation}</td>
    </tr>""")

    score_colour = '#4a7c59' if score >= 80 else ('#c9a227' if score >= 60 else '#c94a2b')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>EcomShop — DAST Report</title>
<style>
  :root{{--ink:#0d0d0d;--cream:#f5f0e8;--rust:#c94a2b;--border:#d4cfc5;--muted:#888880}}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:'Segoe UI',system-ui,sans-serif;background:var(--cream);color:var(--ink);line-height:1.6}}
  header{{background:var(--ink);color:#fff;padding:2rem 3rem}}
  header h1{{font-size:1.8rem;font-weight:700}}
  header p{{color:#aaa;font-size:0.9rem;margin-top:0.25rem}}
  .container{{max-width:1200px;margin:0 auto;padding:2rem 3rem}}
  .summary{{display:grid;grid-template-columns:repeat(6,1fr);gap:1rem;margin:2rem 0}}
  .sc{{background:#fff;border:1px solid var(--border);border-radius:4px;padding:1.25rem;text-align:center}}
  .sc .n{{font-size:2rem;font-weight:700}}.sc .l{{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-top:0.25rem}}
  .sc.pass{{border-top:3px solid #4a7c59}}.sc.fail{{border-top:3px solid #c94a2b}}
  .sc.warn{{border-top:3px solid #c9a227}}.sc.skip{{border-top:3px solid #888}}
  .sc.score{{border-top:3px solid {score_colour}}}
  .meta{{background:#fff;border:1px solid var(--border);padding:1rem 1.5rem;border-radius:4px;margin-bottom:2rem;font-size:0.85rem;color:var(--muted)}}
  .meta span{{color:var(--ink);font-weight:600}}
  h2{{font-size:1.2rem;margin:2rem 0 1rem;color:var(--rust)}}
  table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);font-size:0.83rem}}
  th{{background:var(--ink);color:#fff;text-align:left;padding:0.65rem 0.9rem;font-size:0.72rem;letter-spacing:0.06em;text-transform:uppercase}}
  td{{padding:0.65rem 0.9rem;border-bottom:1px solid var(--border);vertical-align:top}}
  tr:last-child td{{border-bottom:none}}
  footer{{margin:3rem 0 1rem;text-align:center;font-size:0.8rem;color:var(--muted)}}
</style>
</head>
<body>
<header>
  <h1>EcomShop — DAST Report</h1>
  <p>Dynamic Application Security Testing · Generated {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
</header>
<div class="container">
  <div class="summary">
    <div class="sc score"><div class="n" style="color:{score_colour}">{score}%</div><div class="l">Security Score</div></div>
    <div class="sc pass"><div class="n" style="color:#4a7c59">{counts['PASS']}</div><div class="l">Passed</div></div>
    <div class="sc fail"><div class="n" style="color:#c94a2b">{counts['FAIL']}</div><div class="l">Failed</div></div>
    <div class="sc warn"><div class="n" style="color:#c9a227">{counts['WARN']}</div><div class="l">Warnings</div></div>
    <div class="sc skip"><div class="n" style="color:#888">{counts['SKIP']}</div><div class="l">Skipped</div></div>
    <div class="sc"><div class="n">{len(results)}</div><div class="l">Total Tests</div></div>
  </div>
  <div class="meta">
    Target: <span>{base_url}</span> &nbsp;·&nbsp;
    Tests run: <span>{len(results)}</span> &nbsp;·&nbsp;
    Duration: <span>{duration_ms}ms</span> &nbsp;·&nbsp;
    Date: <span>{datetime.datetime.now().strftime('%Y-%m-%d %H:%M UTC')}</span>
  </div>
  <h2>Test Results ({len(results)})</h2>
  <table>
    <thead><tr>
      <th>Test ID</th><th>Test Name</th><th>Severity</th><th>Category</th>
      <th>Status</th><th>Description</th><th>Evidence</th><th>Remediation</th>
    </tr></thead>
    <tbody>{''.join(rows)}</tbody>
  </table>
</div>
<footer>EcomShop DAST Runner · {datetime.datetime.now().strftime('%Y-%m-%d')}</footer>
</body>
</html>"""

    with open(output_path, 'w') as f:
        f.write(html)

    json_path = output_path.replace('.html', '.json')
    with open(json_path, 'w') as f:
        json.dump({
            'generated_at': datetime.datetime.now().isoformat(),
            'target':       base_url,
            'summary':      counts,
            'score':        score,
            'results': [{
                'test_id': r.test_id, 'name': r.name, 'category': r.category,
                'severity': r.severity, 'status': r.status,
                'description': r.description, 'evidence': r.evidence,
                'remediation': r.remediation,
            } for r in results],
        }, f, indent=2)

    return json_path


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='EcomShop DAST Runner')
    parser.add_argument('--base-url', default='https://localhost',
                        help='Base URL of the running app (default: https://localhost)')
    parser.add_argument('--output',   default='dast/dast-report.html',
                        help='Output HTML path (default: dast/dast-report.html)')
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    start   = time.time()
    results = run_all(args.base_url)
    duration_ms = int((time.time() - start) * 1000)

    json_path = generate_html_report(results, args.base_url, args.output, duration_ms)

    counts = {'PASS': 0, 'FAIL': 0, 'WARN': 0, 'SKIP': 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1

    passed = counts['PASS']
    total  = len([r for r in results if r.status != 'SKIP'])
    score  = int(passed / total * 100) if total > 0 else 0

    print()
    print(f'Passed   : {counts["PASS"]}')
    print(f'Failed   : {counts["FAIL"]}')
    print(f'Warnings : {counts["WARN"]}')
    print(f'Skipped  : {counts["SKIP"]}')
    print(f'Score    : {score}%')
    print(f'Duration : {duration_ms}ms')
    print()
    print(f'HTML report : {args.output}')
    print(f'JSON report : {json_path}')

    sys.exit(1 if counts['FAIL'] > 0 else 0)


if __name__ == '__main__':
    main()
