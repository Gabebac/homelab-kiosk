#!/bin/sh
# Health check for the kiosk dashboard (runs from cron every 15 min).
# Writes status to last-probe file; exits nonzero so cron logs the failure.
BASE=${1:-http://127.0.0.1:8644}
TS=$(date +%s)
OK=1
curl -fsS --max-time 10 "$BASE/audio/healthz" >/dev/null 2>&1 || OK=0
curl -fsS --max-time 10 "$BASE/api/audio/../docs" >/dev/null 2>&1 || true
OUT=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$BASE/stats")
if [ "$OUT" != "200" ]; then
  echo "$ts kiosk DOWN ($UPSTREAM http code $OUT from /stats)" > /var/tmp/kiosk-last-check.txt 2>/dev/null || \
  echo "$TS kiosk DOWN (dashboard /stats HTTP $OUT)" >> /tmp/kiosk-last-check.log
  exit 1
fi
echo "$TS ok" >> /tmp/kiosk-health.log
tail -50 /tmp/kiosk-health.log > /tmp/kiosk-health.new && mv /tmp/kiosk-health.new /tmp/kiosk-health.log