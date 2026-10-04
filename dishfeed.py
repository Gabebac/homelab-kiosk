"""Poll the Starlink dish (gRPC via starlink-grpc-tools) and refresh
v3/starlink.json on a loop. Runs as a background host process ( Hermes-side),
writes into the dashboard dir the sidecar serves read-only. 15s cadence.
"""
import json, time, sys, os
sys.path.insert(0, "/opt/data/kiosk/starlink-grpc-tools")
OUT = "/opt/data/kiosk/dashboard/v3/starlink.json"
PEAKS = "/opt/data/kiosk/starlink-peaks.json"
# rolling observed max (48h memory): "full ring = max speeds we get"; arc = current/peak
# → typical heavy use lands ~75-80% lit. ponytail: decay is forget-48h, no fancy stats.
PEAK_TTL = 48 * 3600

def load_peaks():
    try:
        p = json.load(open(PEAKS))
        if time.time() - p.get("ts", 0) < PEAK_TTL:
            return p
    except Exception:
        pass
    return {"down": None, "up": None, "ts": 0}

def save_peaks(p):
    p["ts"] = time.time()
    open(PEAKS + ".tmp", "w").write(json.dumps(p))
    os.replace(PEAKS + ".tmp", PEAKS)

def probe():
    import starlink_grpc
    s = starlink_grpc.get_status()
    alerts = [f.name for f in s.alerts.DESCRIPTOR.fields if getattr(s.alerts, f.name)]
    return {
        "ok": True,
        "state": "OK" if s.ready_states.rf else "DEGRADED",
        "uptime_h": round(s.device_state.uptime_s / 3600),
        "down_mbps": round(s.downlink_throughput_bps / 1e6, 1),
        "up_mbps": round(s.uplink_throughput_bps / 1e6, 1),
        "latency_ms": round(s.pop_ping_latency_ms, 1),
        "quality": round(float(s.signal_quality), 2),
        "obstructed_pct": round(100 * s.obstruction_stats.fraction_obstructed, 2),
        "currently_obstructed": bool(s.obstruction_stats.currently_obstructed),
        "alerts": alerts,
        "hw": s.device_info.hardware_version,
        "sw": s.device_info.software_version,
        "ts": time.time(),
    }

def main():
    idle = {"ok": False, "err": "probe pending", "ts": 0}
    peaks = load_peaks()
    if not peaks.get("down"):
        # no history: seed at plan limits; peaks grow as real traffic hits. Keeps the
        # ring honest (peak = actual observed max) — idle arcs read small, heavy reads big.
        peaks = {"down": 250.0, "up": 50.0}
        save_peaks(peaks)
    while True:
        try:
            idle = probe()
            for k, v in (("down", idle["down_mbps"]), ("up", idle["up_mbps"])):
                if v and v > (peaks.get(k) or 0):
                    peaks[k] = v
            save_peaks(peaks)
            idle["peak_down"] = peaks.get("down")
            idle["peak_up"] = peaks.get("up")
        except Exception as e:
            idle = {"ok": False, "err": str(e)[:160], "ts": time.time()}
        tmp = OUT + ".tmp"
        open(tmp, "w").write(json.dumps(idle))
        os.replace(tmp, OUT)
        time.sleep(15)

if __name__ == "__main__":
    main()