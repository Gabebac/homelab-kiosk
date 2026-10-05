#!/usr/bin/env python3
"""Wall calendar feed: Google Calendar (primary = gabrieltfilho) + Hermes cron jobs -> events.json.
Runs every 15 min (cron job). Token: env GOOGLE_TOKEN (default /opt/data/google_token.json).
"""
import json, time, os, datetime, sys
from google.auth.transport.requests import AuthorizedSession
from google.oauth2.credentials import Credentials

TOKEN = os.environ.get("GOOGLE_TOKEN", "/opt/data/google_token.json")
OUT = "/opt/data/kiosk/dashboard/v3/events.json"
JOBS = "/opt/data/cron/jobs.json"
DAYS = 60
MAX = 50

def gcal_events(sess):
    now=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    end=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=DAYS)).strftime("%Y-%m-%dT23:59:59Z")
    url=f"https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={now}&timeMax={end}&singleEvents=true&orderBy=startTime&maxResults={MAX}"
    r=sess.get(url)
    if not r.ok:
        raise RuntimeError(f"gcal {r.status_code}: {r.text[:120]}")
    out=[]
    for it in r.json().get("items", []):
        st=it.get("start", {}); dt=st.get("dateTime") or st.get("date")
        if not dt: continue
        out.append({"name": it.get("summary") or "(untitled)", "next": dt, "src":"google"})
    return out

def cron_events():
    try:
        d=json.load(open(JOBS))
    except Exception:
        return []
    return [{"name": j.get("name") or "job",
             "schedule": (j.get("schedule",{}) or {}).get("display") or j.get("schedule_display") or "",
             "next": j.get("next_run_at"), "last": j.get("last_status"), "src":"cron"}
            for j in d.get("jobs", []) if j.get("enabled")]

def main():
    d=json.load(open(TOKEN))
    c=Credentials(token=d.get("token"), refresh_token=d.get("refresh_token"), client_id=d.get("client_id"), client_secret=d.get("client_secret"), token_uri=d.get("token_uri"))
    sess=AuthorizedSession(c)
    g=gcal_events(sess)
    cron=[e for e in cron_events() if e.get("next")]
    merged=sorted(cron+g, key=lambda e: e.get("next",""))
    tmp=OUT+".tmp"
    json.dump({"generated": datetime.datetime.now().isoformat(timespec='seconds'), "events": merged}, open(tmp,"w"))
    os.replace(tmp, OUT)
    print(f"events: {len(cron)} cron + {len(g)} google -> {OUT}")

if __name__=="__main__":
    if "--loop" in sys.argv:
        import sys as _s  # module-level guard: loop forever, 15 min cadence
        while True:
            try:
                main()
            except Exception as e:
                print("gcalfeed loop error:", e, flush=True)
            time.sleep(900)
    else:
        main()
