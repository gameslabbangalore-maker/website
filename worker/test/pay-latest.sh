#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SECRET="${1:-}"
if [ -z "$SECRET" ]; then
  SECRET=$(grep -E '^RAZORPAY_WEBHOOK_SECRET=' .dev.vars 2>/dev/null | head -1 | cut -d= -f2-)
fi
if [ -z "$SECRET" ]; then
  echo "No webhook secret. Pass one: ./test/pay-latest.sh whsec_local" >&2
  exit 1
fi

ROW=$(npx wrangler d1 execute gameslab-ticketing --local --json --command \
  "SELECT razorpay_order_id, amount_paise, qty, name FROM bookings
    WHERE status='pending' AND razorpay_order_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 1" 2>/dev/null)

ORDER=$(printf '%s' "$ROW" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)[0]['results']
except Exception:
    r = []
print(r[0]['razorpay_order_id'] if r else '')
")

AMOUNT=$(printf '%s' "$ROW" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)[0]['results']
except Exception:
    r = []
print(r[0]['amount_paise'] if r else 0)
")

if [ -z "$ORDER" ]; then
  echo "No pending booking found. Start one at /book/ first." >&2
  exit 1
fi

echo "Confirming $ORDER (amount ${AMOUNT} paise)"
node test/sign-webhook.mjs --order="$ORDER" --secret="$SECRET" --amount="$AMOUNT" --send
