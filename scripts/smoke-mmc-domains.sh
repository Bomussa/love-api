#!/usr/bin/env bash
set -euo pipefail

BASE="https://mmc-mms.com"
WWW="https://www.mmc-mms.com"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

echo "[INFO] Fetching homepage from both hosts..."
curl -fsSL "$BASE" -o /tmp/mmc-main.html || fail "Unable to fetch $BASE"
curl -fsSL "$WWW" -o /tmp/mmc-www.html || fail "Unable to fetch $WWW"

main_hash=$(sha256sum /tmp/mmc-main.html | awk '{print $1}')
www_hash=$(sha256sum /tmp/mmc-www.html | awk '{print $1}')

if [[ "$main_hash" != "$www_hash" ]]; then
  fail "Host mismatch: mmc-mms.com and www.mmc-mms.com return different HTML payloads"
fi

echo "[PASS] Host payload parity verified ($main_hash)"

check_endpoint() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="$BASE$path"
  local code

  if [[ "$method" == "POST" ]]; then
    code=$(curl -sS -o /tmp/mmc-endpoint.json -w "%{http_code}" \
      -X POST "$url" -H "content-type: application/json" -d "$data") || fail "Request failed: $method $path"
  else
    code=$(curl -sS -o /tmp/mmc-endpoint.json -w "%{http_code}" "$url") || fail "Request failed: $method $path"
  fi

  case "$path" in
    "/api/health"|"/api/v1/status")
      [[ "$code" == "200" ]] || fail "$path expected 200, got $code"
      ;;
    *)
      # Some routes are protected by edge authentication in production.
      [[ "$code" == "200" || "$code" == "401" ]] || fail "$path expected 200 or 401, got $code"
      ;;
  esac

  echo "[PASS] $method $path -> HTTP $code"
}

check_endpoint GET /api/health
check_endpoint GET /api/v1/status
check_endpoint GET /api/v1/health
check_endpoint GET '/api/v1/queue/status?clinic_id=demo'
check_endpoint POST /api/v1/pin/verify '{"pin":"0000","clinic_id":"demo"}'

echo "[PASS] smoke-mmc-domains completed successfully"
