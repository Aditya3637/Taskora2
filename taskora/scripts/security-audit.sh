#!/usr/bin/env bash
# Dependency vulnerability audit. Runs pip-audit for the Python backend
# and `npm audit` for the Next.js web app. Exits non-zero if any
# high/critical advisories are found so it can gate a CI pipeline.
#
# Usage:
#   ./scripts/security-audit.sh              # human-readable summary
#   ./scripts/security-audit.sh --json       # machine output
#
# Install once before first run:
#   python3 -m pip install pip-audit

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

echo "==> Backend (pip-audit)"
cd "$ROOT/apps/backend"
if ! command -v pip-audit >/dev/null 2>&1; then
  echo "  pip-audit not installed. Run: python3 -m pip install pip-audit"
  FAIL=1
else
  pip-audit -r requirements.txt --strict || FAIL=1
fi

echo
echo "==> Web (npm audit)"
cd "$ROOT/apps/web"
# --audit-level=high so dev-only or low-severity advisories don't block
# the pipeline (we still see them in the report).
npm audit --audit-level=high || FAIL=1

echo
if [ $FAIL -ne 0 ]; then
  echo "Security audit FAILED — see findings above."
  exit 1
fi
echo "Security audit clean."
