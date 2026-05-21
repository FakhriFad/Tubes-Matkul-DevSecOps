#!/usr/bin/env bash
# ============================================================
# generate-lockfiles.sh
#
# Run this ONCE after cloning to generate package-lock.json
# for both backend and frontend. Commit the lock files.
# After that, Docker builds and CI will use `npm ci`
# (faster and reproducible).
#
# Requires: Node.js 20+, network access
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Generating backend/package-lock.json ..."
cd "$ROOT/backend"
npm install --package-lock-only
echo "  Done: backend/package-lock.json"

echo ""
echo "Generating frontend/package-lock.json ..."
cd "$ROOT/frontend"
npm install --package-lock-only
echo "  Done: frontend/package-lock.json"

echo ""
echo "Lock files generated. Commit them:"
echo "  git add backend/package-lock.json frontend/package-lock.json"
echo "  git commit -m 'chore: add package-lock.json for reproducible builds'"
