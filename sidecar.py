"""Kiosk stats sidecar + avatar brain bridge.

Serves the dashboard's stat panels AND proxies chat turns to the Hermes
gateway as the same "me" the Telegram/desktop surfaces use (same profile,
same memory). Listens on :8644, host network so Chromium hits it directly
and we can read /proc + docker.sock for stats.

Endpoints:
    GET  /                -> dashboard index.html
    GET  /stats           -> host + docker + services snapshot
    POST /ask             -> {"text": "..."} -> asks Hermes (prompt.submit over
                             gateway WS), returns {"reply", "complete"}

Auth: none on stats (LAN-only via binding 127.0.0.1 is WRONG for Chromium
host-net access; bind 0.0.0.0 — the box is LAN-trusted per owner).

ponytail: single file, no DB, no task queue; /ask holds one WS session open
per request (sequential turns, no concurrency beyond the wall's one user).
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

from defusedxml import ElementTree as SafeET
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

app = FastAPI(docs_url=None, redoc_url=None)

GW = "http://172.31.0.4:9119"  # pilot's IP on hermes-next-pilot-net; host-net sidecar reaches it directly
HERMES_HOME = Path("/opt/data")  # pilot's bind; also OUR /opt/data

# ---- token minting (gateway-signature-compatible; see PROTOCOL.md) ----
# The 64-hex 'secret' in config.yaml also parses as base64; the gateway's
# plugins/dashboard_auth/basic.py resolves secrets base64-FIRST (48 bytes),
# not hex. Local copy of that resolver + the HMAC signer so the sidecar
# sidecontainer (no /opt/hermes) mints tokens the gateway accepts.
def _resolve_secret(raw: str) -> bytes:
    import base64 as _b64
    for decoder in (_b64.b64decode, bytes.fromhex):
        try:
            decoded = decoder(raw.strip())
            if len(decoded) >= 16:
                return decoded
        except (ValueError, TypeError):
            pass
    return raw.encode("utf-8")


def _read_basic_auth() -> dict:
    import yaml
    cfg = yaml.safe_load(open(str(HERMES_HOME / "config.yaml")))
    return cfg["dashboard"]["basic_auth"]


def _mint_access_token(ttl: int = 3600) -> str:
    import base64 as _b64
    import hashlib as _hl
    import hmac as _hmac
    ba = _read_basic_auth()
    secret = _resolve_secret(ba["secret"])
    now = int(time.time())
    payload = {"sub": ba["username"], "kind": "access", "exp": now + ttl}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    sig = _hmac.new(secret, raw, _hl.sha256).digest()
    return _b64.urlsafe_b64encode(raw + sig).decode()


def _ws_ticket(token: str) -> str:
    req = urllib.request.Request(f"{GW}/api/auth/ws-ticket", data=b"", method="POST",
                                 headers={"Authorization": f"Bearer {token}",
                                          "Origin": "http://172.31.0.4:9119"})
    with urllib.request.urlopen(req, timeout=10) as f:
        return json.load(f)["ticket"]


# ---- raw-WS client for the gateway JSON-RPC ----

def _ws_connect(ticket: str):
    import socket, base64 as b64, hashlib as hl
    sock = socket.create_connection(("172.31.0.4", 9119), timeout=10)
    key = os.urandom(16)
    hdr = (f"GET /api/ws?ticket={ticket} HTTP/1.1\r\n"
           f"Host: 172.31.0.4:9119\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\n"
           f"Sec-WebSocket-Key: {b64.b64encode(key).decode()}\r\n"
           f"Sec-WebSocket-Version: 13\r\n\r\n")
    sock.sendall(hdr.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += sock.recv(4096)
    if b"101" not in resp.split(b"\r\n", 1)[0]:
        sock.close()
        raise RuntimeError("WS upgrade refused: " + resp[:120].decode(errors="replace"))
    return sock

def _ws_send(sock, obj):
    import os as _os
    payload = json.dumps(obj).encode()
    mask = _os.urandom(4)
    ln = len(payload)
    if ln < 126:
        head = bytes([0x81, 0x80 | ln])
    elif ln < 65536:
        head = bytes([0x81, 0x80 | 126, ln >> 8, ln & 0xFF])
    else:
        head = bytes([0x81, 0x80 | 127]) + ln.to_bytes(8, "big")
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(head + mask + masked)

def _ws_frames(sock):
    """Yield opcode-1 (text) JSON frames; handles fragmentation, skips ping/pong."""
    import base64 as _b64
    buf = b""
    frag = b""
    frag_op = 0
    while True:
        while len(buf) >= 2:
            b0, b1 = buf[0], buf[1]
            op = b0 & 0x0F
            masked = bool(b1 & 0x80)
            ln = b1 & 0x7F
            off = 2
            if ln == 126:
                if len(buf) < 4:
                    break
                ln = int.from_bytes(buf[2:4], "big")
                off = 4
            elif ln == 127:
                if len(buf) < 10:
                    break
                ln = int.from_bytes(buf[2:10], "big")
                off = 10
            total = off + ln + (4 if masked else 0)
            if len(buf) < total:
                break
            payload = buf[off:off + ln]
            if masked:
                mask = buf[off + ln:total]
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            buf = buf[total:]
            if op == 0x8:  # close
                return
            if op == 0x9:  # ping → pong with same payload
                pong_hdr = bytes([0x8A, 0x80 | len(payload)]) + os.urandom(4) + \
                    bytes(b ^ os.urandom(4)[i % 4] for i, b in enumerate(payload))
                # (mask fresh each byte read — cheap and correct: XOR order preserved below)
                m = pong_hdr[2:6]
                masked_p = bytes(b ^ m[i % 4] for i, b in enumerate(payload))
                sock.sendall(bytes([0x8A, 0x80 | len(payload)]) + m + masked_p)
                continue
            if op == 0xA:  # pong
                continue
            if op == 0x1:  # text
                if b0 & 0x80:  # FIN
                    if frag:
                        frag += payload
                        try:
                            yield json.loads(frag.decode())
                        except json.JSONDecodeError:
                            pass
                        frag = b""
                    else:
                        try:
                            yield json.loads(payload.decode())
                        except json.JSONDecodeError:
                            continue
                else:
                    frag = payload
            elif op == 0x0:  # continuation
                frag += payload
                if b0 & 0x80:
                    try:
                        yield json.loads(frag.decode())
                    except json.JSONDecodeError:
                        pass
                    frag = b""
            elif op == 0x2:  # binary
                continue
        chunk = sock.recv(65536)
        if not chunk:
            return
        buf += chunk


def ask_hermes_streaming(text: str):
    """Yields reply text deltas from one prompt.submit turn."""
    token = _mint_access_token()
    ticket = _ws_ticket(token)
    sock = _ws_connect(ticket)

    # dedicated kiosk session per gateway process — one persistent sid reuse
    _ws_send(sock, {"jsonrpc": "2.0", "id": 1, "method": "session.create", "params": {"title": "Wall Kiosk"}})
    sid = None
    for frame in _ws_frames(sock):
        if frame.get("id") == 1:
            if "error" in frame:
                raise RuntimeError(f"session.create failed: {frame['error']}")
            sid = frame["result"]["session_id"]
            break

    _ws_send(sock, {"jsonrpc": "2.0", "id": 2, "method": "prompt.submit",
                    "params": {"session_id": sid, "text": text, "surface": "desktop"}})
    for frame in _ws_frames(sock):
        if frame.get("id") == 2:
            if "error" in frame:
                raise RuntimeError(f"prompt.submit refused: {frame['error']}")
            break
    # delta events follow; collect until turn-complete marker.
    # Verified live: message.delta carries the text, message.complete ends the turn.
    reply_parts = []
    complete = False
    for frame in _ws_frames(sock):
        params = frame.get("params") or {}
        ev = params.get("type") or ""
        payload = params.get("payload") or {}
        if ev in ("message.complete", "turn.completed", "turn.complete", "turn.end",
                  "turn.result", "turn.done"):
            complete = True
            break
        if ev == "thinking.delta":  # reasoning text, not the reply
            continue
        if ev == "message.delta" and isinstance(payload, dict):
            delta = payload.get("text")
            if isinstance(delta, str) and delta:
                reply_parts.append(delta)
    sock.close()
    return "".join(reply_parts), complete

# ---- single-shot blocking ask (lazy; we don't async-drive sockets for one wall) ----

class Ask(BaseModel):
    text: str


@app.post("/ask")
def ask(payload: Ask):
    try:
        reply, done = ask_hermes_streaming(payload.text)
    except Exception as e:
        raise HTTPException(502, f"gateway unreachable: {e}")
    if not reply and not done:
        raise HTTPException(502, "turn produced no reply")
    return {"ok": True, "reply": reply, "complete": done}


# ---- stats ----

_service_ports = {
    "plex": 32400, "radarr": 7878, "sonarr": 8989, "prowlarr": 9696,
    "deluge-web": 8112, "audiobookshelf": 13378, "vaultwarden": 10380,
    "ollama": 11434, "n8n": 5678, "obsidian": 15323, "romm": 8200,
    "pihole-web": 8800, "hermes-kiosk-sidecar": 8644,
}

def docker_ps_healthy():
    # docker CLI is not in the slim image; talk to the docker socket API directly
    import http.client
    class _UnixConn(http.client.HTTPConnection):
        def __init__(self):
            super().__init__("localhost")
        def connect(self):
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(10)
            self.sock.connect("/var/run/docker.sock")
    conn = _UnixConn()
    conn.request("GET", "/v1.43/containers/json")
    with conn.getresponse() as resp:
        data = json.load(resp)
    conn.close()
    out = {}
    for c in data:
        name = (c.get("Names") or [""])[0].lstrip("/")
        st = c.get("Status", "")
        m = re.search(r"\((healthy|unhealthy)\)", st)
        out[name] = m.group(1) if m else ("up" if st.startswith("Up") else st.split()[0].lower())
    return out


def host_stats():
    mem = {}
    for line in open("/proc/meminfo"):
        k, v = line.split(":", 1)
        mem[k.strip()] = int(re.sub(r"\D", "", v) or 0) * 1024
    load1 = open("/proc/loadavg").read().split()[0]
    df = subprocess.run(["df", "-BG", "/opt/data"], capture_output=True, text=True).\
        stdout.strip().splitlines()[-1].split()
    return {
        "load1": float(load1),
        "cpu_count": os.cpu_count(),
        "mem_used_gb": round((mem["MemTotal"] - mem["MemAvailable"]) / 1e9),
        "mem_total_gb": round(mem["MemTotal"] / 1e9),
        "swap_used_gb": round((mem.get("SwapTotal", 0) - mem.get("SwapFree", 0)) / 1e9, 1),
        "swap_total_gb": round(mem.get("SwapTotal", 0) / 1e9, 1),
        "disk_used_gb": int(df[2].rstrip("G")),
        "disk_total_gb": int(df[1].rstrip("G")),
        "disk_pct": int(df[4].rstrip("%")),
    }


_sid = {"v": None, "t": 0.0}

def _pihole_sid():
    # session TTL is 1800s; reuse sid instead of re-authing every poll (429 otherwise)
    if _sid["v"] and time.time() - _sid["t"] < 1500:
        return _sid["v"]
    pw_path = Path("/appdata/pihole/etc/pihole/cli_pw")
    pw = pw_path.read_text().strip() if pw_path.exists() else ""
    if not pw:
        pw = subprocess.run(["cat", "/appdata/pihole/etc/pihole/cli_pw"],
                            capture_output=True, text=True, timeout=10).stdout.strip()
    req = urllib.request.Request("http://192.168.0.78:8800/api/auth",
                                 data=json.dumps({"password": pw}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as f:
        sid = json.load(f)["session"]["sid"]
    _sid["v"], _sid["t"] = sid, time.time()
    return sid

def pihole_summary():
    sid = _pihole_sid()
    req2 = urllib.request.Request("http://192.168.0.78:8800/api/stats/summary",
                                  headers={"X-FTL-SID": sid})
    with urllib.request.urlopen(req2, timeout=10) as f:
        s = json.load(f)
    q = s.get("queries", {})
    return {"total": q.get("total"), "blocked": q.get("blocked"),
            "pct": q.get("percent_blocked")}


def plex_now_playing():
    # Plex token via the box-side AppData bind (no docker exec needed)
    pref = Path("/appdata/plex/config/Library/Application Support/Plex Media Server/Preferences.xml")
    tok = ""
    if pref.exists():
        m = re.search(r'PlexOnlineToken="([^"]+)"', pref.read_text(errors="replace"))
        if m:
            tok = m.group(1)
    if not tok:
        return []
    with urllib.request.urlopen(
            f"http://192.168.0.78:32400/status/sessions?X-Plex-Token={tok}", timeout=10) as f:
        root = SafeET.fromstring(f.read())  # defusedxml — Plex XML is LAN-trusted but parse-hardened anyway
    out = []
    for v in root.iter("Video"):
        out.append({"title": v.get("title"), "type": v.get("type"),
                    "progress": int(float(v.get("viewOffset", 0) or 0) /
                                    max(1, int(v.get("duration", 1) or 1)) * 100)})
    return out


def arr_queue():
    def one(base, key):
        req = urllib.request.Request(f"{base}/api/v3/queue?page=1&pageSize=6",
                                     headers={"X-Api-Key": key})
        with urllib.request.urlopen(req, timeout=10) as f:
            q = json.load(f)
        return {"total": q.get("totalRecords"),
                "items": [{"title": it.get("title"), "status": it.get("status"),
                           "left_gb": round((it.get("sizeLeft") or 0) / 1e9, 1),
                           "msg": it.get("statusMessage")} for it in (q.get("records") or [])]}
    # *arr ApiKeys live in each service's config.xml under their AppData binds
    def key_from(xml_path):
        txt = Path(xml_path).read_text(errors="replace")
        return re.search(r"<ApiKey>([a-f0-9]{32})</ApiKey>", txt).group(1)
    radarr_key = key_from("/appdata/radarr/config/config.xml")
    sonarr_key = key_from("/appdata/sonarr/config/config.xml")
    return {"radarr": one("http://192.168.0.78:7878", radarr_key),
            "sonarr": one("http://192.168.0.78:8989", sonarr_key)}


@app.get("/stats")
def stats():
    # ponytail: per-source try/except so one dead source degrades to null, not a whole-page 500
    def safe(fn):
        try:
            return fn()
        except Exception:
            return None
    containers = safe(docker_ps_healthy)
    return {
        "host": safe(host_stats),
        "containers": containers,
        "services": {name: ("up" if _tcp_up(p) else "down") for name, p in _service_ports.items()},
        "pihole": safe(pihole_summary),
        "plex": safe(plex_now_playing),
        "arr": safe(arr_queue),
        "ts": time.time(),
    }

def _tcp_up(port):  # bind-target differs per service (ollama pins the box IP) — probe both
    for host in ("127.0.0.1", "192.168.0.78"):
        s = socket.socket()
        s.settimeout(2)
        try:
            s.connect((host, port))
            return True
        except Exception:
            continue
        finally:
            s.close()
    return False


# ---- dashboard shell ----

DASH_DIR = Path("/opt/data/kiosk/dashboard")

@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(DASH_DIR / "index.html")

# avatar model assets (Live2D) + pages, same-origin so the model can fetch them
app.mount("/av", StaticFiles(directory=DASH_DIR / "av"), name="av")
app.mount("/v2", StaticFiles(directory=DASH_DIR / "v2", html=True), name="v2")

# ---- V3: EcoFlow battery + GitHub contributions ----
import hmac as _hmac, hashlib as _hl, time as _time
_ECO_F = Path("/opt/data/kiosk/dashboard/v3/ecoflow.json")
_gh_cache = {"t": 0, "days": []}

def _eco_headers(creds, params: dict) -> dict:
    ak, sk = creds["AK"], creds["SK"]
    nonce = str(int(_time.time() * 1000) % 1000000).zfill(6)
    ts = str(int(_time.time() * 1000))
    # EcoFlow sign: request params in request order FIRST, then reserved params
    pairs = [f"{k}={params[k]}" for k in params]
    pairs += [f"accessKey={ak}", f"nonce={nonce}", f"timestamp={ts}"]
    sign = _hmac.new(sk.encode(), "&".join(pairs).encode(), _hl.sha256).hexdigest()
    return {"accessKey": ak, "nonce": nonce, "timestamp": ts, "sign": sign}

@app.get("/ecoflow")
def ecoflow():
    try:
        creds = json.loads(_ECO_F.read_text())
        sn = creds["SN"]
        q = urllib.parse.urlencode({"sn": sn})
        req = urllib.request.Request(
            f"https://api.ecoflow.com/iot-open/sign/device/quota/all?{q}",
            headers=_eco_headers(creds, {"sn": sn}))
        with urllib.request.urlopen(req, timeout=15) as f:
            d = json.load(f)
        if d.get("code") != "0":
            return {"ok": False, "err": d.get("message")}
        q = d.get("data", {})
        return {"ok": True, "name": "RIVER 2 Pro", "sn": sn,
                "soc": q.get("pd.soc", 0),
                "outW": q.get("pd.wattsOutSum", 0),
                "inW": (q.get("inv.inputWatts", 0) or 0) + (q.get("mppt.inWatts", 0) or 0),
                "remainMin": q.get("bms_bmsStatus.remainTime", 0)}
    except Exception as e:
        return {"ok": False, "err": str(e)}

app.mount("/v3", StaticFiles(directory=DASH_DIR / "v3", html=True), name="v3")

# ---- V3: last 5 add requests (radarr+sonarr grabbed) ----
_arrcreds = DASH_DIR / "arrcreds.json"   # {"radarr": key, "sonarr": key} — gitignored

def plex_lists():
    try:
        creds = json.loads(_arrcreds.read_text())
    except Exception:
        return []
    out = []
    for name, port, kind in (("radarr", 7878, "movie"), ("sonarr", 8989, "series")):
        key = creds.get(name)
        if not key: continue
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/v3/history?sortKey=date&sortDirection=descending&pageSize=100&apikey={key}",
                timeout=10) as f:
                d = json.load(f)
            recs = d.get("records", d if isinstance(d, list) else [])
            for rec in recs:
                ev = rec.get("eventType")
                if ev in ("grabbed", "downloadFolderImported"):
                    title = rec.get("sourceTitle", "")
                    t = re.sub(r"[.\-_]+", " ", title).strip()
                    t = re.sub(r"\s+", " ", t)
                    t = re.sub(r"\b(1080p|2160p|720p|BluRay|WEB-DL|WEBRip|x264|x265|HEVC|10bit|DDP5|DD|Atmos|REMASTERED|AMZN|NF|H-SBS|REPACK).*$", "", t, flags=re.I).strip(" -")
                    out.append({"kind": kind, "ev": ev, "date": rec["date"], "title": t[:60] or title[:60]})
        except Exception:
            continue
    out.sort(key=lambda x: x["date"], reverse=True)
    reqs = [x for x in out if x["ev"] == "grabbed"][:5]
    adds = [x for x in out if x["ev"] == "downloadFolderImported"][:5]
    return {"requests": reqs, "added": adds}

@app.get("/plexreqs")
def plexreqs():
    return plex_lists()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8644, log_level="warning")
