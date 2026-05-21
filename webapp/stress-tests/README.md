# EcomShop — Stress Testing Guide

## Prerequisites

Install k6 (free, open-source load testing tool):
```bash
# macOS
brew install k6

# Ubuntu / Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows (scoop)
scoop install k6

# Docker (no install needed)
docker run --rm -i grafana/k6 run - <stress-tests/k6-tests.js
```

## Test Scenarios

| Scenario | VUs     | Duration | Purpose                              |
|----------|---------|----------|--------------------------------------|
| smoke    | 1       | 1 min    | Sanity check — all endpoints respond |
| load     | 0→50    | 5 min    | Normal sustained traffic             |
| stress   | 0→200   | 10 min   | Find the breaking point              |
| spike    | 10→300  | ~3 min   | Sudden traffic burst (flash sale)    |
| soak     | 30      | 30 min   | Memory leaks / long-term degradation |

## Performance Targets

| Metric              | Target    |
|---------------------|-----------|
| p95 response time   | < 500ms   |
| p99 response time   | < 1000ms  |
| Error rate          | < 1%      |
| Throughput (load)   | > 100 req/s |

## Running Tests

Make sure the app is running first:
```bash
docker compose up -d
```

### Smoke test (always run first)
```bash
k6 run stress-tests/k6-tests.js -e SCENARIO=smoke
```

### Load test
```bash
k6 run stress-tests/k6-tests.js -e SCENARIO=load
```

### Stress test
```bash
k6 run stress-tests/k6-tests.js -e SCENARIO=stress
```

### Spike test
```bash
k6 run stress-tests/k6-tests.js -e SCENARIO=spike
```

### Soak test
```bash
k6 run stress-tests/k6-tests.js -e SCENARIO=soak
```

### Save results to JSON (for reporting)
```bash
k6 run --out json=stress-tests/results-load.json \
  stress-tests/k6-tests.js -e SCENARIO=load
```

### Against a different host
```bash
k6 run stress-tests/k6-tests.js \
  -e SCENARIO=load \
  -e BASE_URL=https://myserver.example.com
```

## Reading Results

k6 prints a summary like this:
```
          /\      |‾‾| /‾‾/   /‾‾/   
     /\  /  \     |  |/  /   /  /    
    /  \/    \    |     (   /   ‾‾\  
   /          \   |  |\  \ |  (‾)  | 
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: stress-tests/k6-tests.js

  scenarios: (100.00%) 1 scenario, 50 max VUs, 5m30s max duration

✓ register: status 201
✓ login: status 200
✓ items list: status 200

    ✓ http_req_duration.............: avg=45ms  p(95)=180ms  p(99)=420ms
    ✗ error_rate....................: 0.02% ✓ passes threshold
    
  http_req_duration.......: avg=45.2ms min=8.1ms  med=32.4ms  max=892ms
                            p(90)=98.5ms p(95)=180ms p(99)=420ms
  http_reqs..................: 18420  61.4/s
  login_duration............: avg=52ms p(95)=210ms
  items_duration............: avg=12ms p(95)=45ms   ← cache working
  checkout_duration.........: avg=180ms p(95)=450ms
```

**Key things to look for:**
- `p(95)` values — must stay under thresholds
- `✗` marks — threshold violations = performance requirements not met
- `http_req_failed` — anything above 1% needs investigation
- `items_duration` p95 should be very low (< 50ms) if Redis cache is working

## Interpreting Common Failures

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `p(95) > 500ms` under load | DB connection pool exhausted | Increase `max` in `config/db.js` |
| `error_rate > 1%` | Rate limiting too aggressive | Tune nginx `limit_req` zone |
| `checkout_duration` spikes | Transaction lock contention | Review checkout query isolation |
| `items_duration` high | Redis cache cold / miss | Verify Redis is running |
| 429 responses | nginx rate limit hit | Expected under spike test |

## Monitoring During Tests

Start the monitoring stack then run tests:
```bash
# Terminal 1 — start monitoring
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

# Terminal 2 — run stress test
k6 run stress-tests/k6-tests.js -e SCENARIO=load

# Then open Grafana: http://localhost:3001
# Username: admin  Password: admin (or value of GRAFANA_PASSWORD in .env)
```
