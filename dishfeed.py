"""Poll the Starlink dish (gRPC via starlink-grpc-tools) and refresh
v3/starlink.json on a loop. Runs as a background host process ( Hermes-side),
writes into the dashboard dir the sidecar serves read-only. 15s cadence.
"""
import json, time, sys
sys.path.insert(0, "/opt/data/kiosk/starlink-grpc-tools")
OUT = "/opt/data/kiosk/dashboard/v3/starlink.json"

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
    while True:
        try:
            idle = probe()
        except Exception as e:
            idle = {"ok": False, "err": str(e)[:160], "ts": time.time()}
        tmp = OUT + ".tmp"
        open(tmp, "w").write(json.dumps(idle))
        import os
        os.replace(tmp, OUT)
        time.sleep(15)

if __name__ == "__main__":
    main()