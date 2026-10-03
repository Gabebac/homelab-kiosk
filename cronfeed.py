#!/usr/bin/env python3
"""Regenerate dashboard/v3/events.json from Hermes cron jobs.json (host-side; sidecar can't see /opt/data/cron)."""
import json
OUT = "/opt/data/kiosk/dashboard/v3/events.json"
d = json.load(open("/opt/data/cron/jobs.json"))
events = []
for j in d.get("jobs", []):
    if not j.get("enabled"): continue
    events.append({
        "name": j.get("name") or "job",
        "schedule": j.get("schedule", {}).get("display") or j.get("schedule_display") or "",
        "next": j.get("next_run_at"),
        "last": j.get("last_status"),
    })
open(OUT, "w").write(json.dumps({"generated": d.get("updated_at"), "events": events}))
print("events:", len(events))
