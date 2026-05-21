.PHONY: help setup certs build up up-fresh down logs \
        scale-backend scale-frontend ps clean test sast dast \
        monitoring monitoring-down stress-smoke stress-load stress-stress stress-spike stress-soak

# Default target
help:
	@echo ""
	@echo "  EcomShop — available commands"
	@echo ""
	@echo "  First time:"
	@echo "    make setup            Copy .env.example → .env and generate TLS cert"
	@echo "    make up               Build images and start all services"
	@echo ""
	@echo "  Daily use:"
	@echo "    make up               Start (builds only changed layers)"
	@echo "    make up-fresh         Full rebuild with --no-cache then start"
	@echo "    make down             Stop containers (data volumes preserved)"
	@echo "    make logs             Tail logs from all services"
	@echo "    make ps               Show running container status"
	@echo ""
	@echo "  Testing:"
	@echo "    make test             Run backend unit tests (no app needed)"
	@echo "    make sast             Run SAST scanner, outputs sast/sast-report.html"
	@echo "    make dast             Run DAST against live app, outputs dast/dast-report.html"
	@echo ""
	@echo "  Stress testing (app must be running):"
	@echo "    make stress-smoke     1 VU, 1 min — sanity check"
	@echo "    make stress-load      50 VUs, 5 min — normal load"
	@echo "    make stress-stress    200 VUs — find breaking point"
	@echo "    make stress-spike     300 VU burst — flash sale simulation"
	@echo "    make stress-soak      30 VUs, 30 min — memory leak detection"
	@echo ""
	@echo "  Monitoring:"
	@echo "    make monitoring       Start Prometheus + Grafana"
	@echo "    make monitoring-down  Stop monitoring stack"
	@echo ""
	@echo "  Scaling:"
	@echo "    make scale-backend    Scale backend to 3 replicas"
	@echo "    make scale-frontend   Scale frontend to 2 replicas"
	@echo ""
	@echo "  Cleanup:"
	@echo "    make clean            Remove containers, volumes, images, and certs"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────

setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example — fill in your secrets before running 'make up'"; \
	else \
		echo ".env already exists — skipping copy"; \
	fi
	@$(MAKE) certs

certs:
	@chmod +x nginx/generate-certs.sh
	@./nginx/generate-certs.sh

# ── Build & Run ───────────────────────────────────────────────────────────────

build:
	docker compose build

up: certs
	@if [ ! -f .env ]; then \
		echo ""; \
		echo "  ERROR: .env file not found."; \
		echo "  Run 'make setup' first, then edit .env with your secrets."; \
		echo ""; \
		exit 1; \
	fi
	docker compose up --build -d
	@echo ""
	@echo "  Application running at https://localhost"
	@echo "  Default admin: admin@shop.local / Admin@12345"
	@echo ""

up-fresh: certs
	@if [ ! -f .env ]; then \
		echo "  ERROR: .env file not found. Run 'make setup' first."; \
		exit 1; \
	fi
	docker compose build --no-cache
	docker compose up -d
	@echo ""
	@echo "  Application running at https://localhost"
	@echo ""

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

# ── Unit Tests ────────────────────────────────────────────────────────────────

test:
	@echo "Generating test stubs..."
	@cd backend && node tests/create-stubs.js
	@echo "Running backend unit tests..."
	@cd backend && node --test tests/*.test.js

# ── SAST ──────────────────────────────────────────────────────────────────────

sast:
	@echo "Running SAST scanner..."
	@python3 sast/scanner.py --project . --output sast/sast-report.html; \
	EXIT=$$?; \
	echo ""; \
	echo "  Report: sast/sast-report.html"; \
	echo "  JSON:   sast/sast-report.json"; \
	exit $$EXIT

# ── DAST ──────────────────────────────────────────────────────────────────────

dast:
	@echo "Running DAST against https://localhost ..."
	@echo "Make sure the app is running first: make up"
	@echo ""
	@python3 dast/dast_runner.py \
		--base-url https://localhost \
		--output dast/dast-report.html; \
	EXIT=$$?; \
	echo ""; \
	echo "  Report: dast/dast-report.html"; \
	echo "  JSON:   dast/dast-report.json"; \
	exit $$EXIT

# ── Stress Tests (k6 via Docker — no install required) ───────────────────────
# Uses --network host-gateway on Linux so k6 can reach https://localhost.
# Adjust BASE_URL if your setup differs.

K6_IMAGE = grafana/k6
K6_OPTS  = run --insecure-skip-tls-verify /tests/k6-tests.js

_k6:
	docker run --rm -i \
		--network ecommerce_public_net \
		-e SCENARIO=$(SCENARIO) \
		-e BASE_URL=https://nginx \
		-v "$(CURDIR)/stress-tests:/tests" \
		$(K6_IMAGE) $(K6_OPTS)

stress-smoke:
	@$(MAKE) _k6 SCENARIO=smoke

stress-load:
	@$(MAKE) _k6 SCENARIO=load

stress-stress:
	@$(MAKE) _k6 SCENARIO=stress

stress-spike:
	@$(MAKE) _k6 SCENARIO=spike

stress-soak:
	@$(MAKE) _k6 SCENARIO=soak

# ── Monitoring ────────────────────────────────────────────────────────────────

monitoring:
	@echo "Starting monitoring stack..."
	docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
	@echo ""
	@echo "  Grafana:    http://localhost:3001  (admin / $${GRAFANA_PASSWORD:-admin})"
	@echo "  Prometheus: http://localhost:9090"
	@echo ""

monitoring-down:
	docker compose -f docker-compose.yml -f docker-compose.monitoring.yml down

# ── Scaling ───────────────────────────────────────────────────────────────────

scale-backend:
	docker compose up -d --scale backend=3 --no-recreate
	@echo "Backend scaled to 3 replicas"

scale-frontend:
	docker compose up -d --scale frontend=2 --no-recreate
	@echo "Frontend scaled to 2 replicas"

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean:
	docker compose down -v --rmi local
	rm -rf nginx/ssl/server.crt nginx/ssl/server.key
	@echo "Cleaned containers, volumes, images, and certs"
