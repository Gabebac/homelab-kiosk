# Kiosk avatar ↔ gateway protocol design doc

# Kiosk avatar ↔ gateway protocol design doc

This kiosk takes over the HDMI-A-2 monitor and shows wall stats + an interactive Hermes avatar.

## Architecture

```
Monitor (HDMI-A-2) ← kiosk image (Xorg:0 + Chromium kiosk) → dashboard UI
    |                                |
    |  /proc, /sys (host netns)      |  fetch(192.168.0.78:8644/*)   [LAN]
    |  /var/run/docker.sock          |  fetch(gw:9119/api/*)         [hermes-next-pilot-net]
    v                                v
stats-sidecar FastAPI on :8644  →  pilot/gateway HTTP/WS
```

Two containers, both `--network host`, --restart unless-stopped:
- `stats-sidecar`: tiny python:3.12-slim FastAPI. Reads /proc, /sys, /var/run/docker.sock (host netns). Exposes :8644/stats, :8644/openclash, :8644/alerts, :8644/pihole (proxied json), :8644/speak (TTS, streams raw PCM), :8644/ask (POST -> prompt.submit over WS + return final answer)
- `hermes-kiosk`: debian + Xorg + Chromium, DISPLAY=:0 on tty7, fullscreen

## WS auth (reverse-engineered from gateway source)

Dashboard auth = basicAuth (pooh, scrypt hash in config.yaml).

**Key insight (root cause of 401s on first try):** the 64-char hex secret in `dashboard.basic_auth.secret` ALSO parses as valid base64 — and base64 decode is tried FIRST in `_resolve_secret` — so the gateway signs with the 48-byte BASE64-DECODED value of the hex string, not the raw bytes/hex bytes themselves. Anything minting session tokens MUST reuse `plugins.dashboard_auth.basic._resolve_secret(cfg_section)` and not hand-decode.

### Token minting (in-process python, must run inside the gateway's container OR have that config+secret)

```python
import base64, json, hmac, hashlib, time, sys
sys.path.insert(0, '/opt/hermes')
import importlib
basic = importlib.import_module('plugins.dashboard_auth.basic')
import yaml
cfg = yaml.safe_load(open('/opt/data/config.yaml'))
ba = cfg['dashboard']['basic_auth']
secret = basic._resolve_secret(ba)     # ← 48-byte b64-decoded of the hex str
now = int(time.time())
payload = {'sub': ba['username'], 'kind': 'access', 'exp': now + 3600}
raw = json.dumps(payload, separators=(',', ':')).encode()
token = base64.urlsafe_b64encode(raw + hmac.new(secret, raw, hashlib.sha256).digest()).decode()
```

### WS ticket flow (2 hops, no cookies needed)

```
POST /api/auth/ws-ticket   Authorization: Bearer <token>   → {"ticket", ttl 30s}
WS  /api/ws?ticket=<ticket> → jsonrpc 2.0 over masked WS frames
```

### prompt.submit — the chat-turn RPC

`{'jsonrpc':'2.0','id':1,'method':'prompt.submit','params':{...}}`

- Streams events (deltas, tool calls, deltas etc.) back on same WS
- Also emits `sessions.changed` broadcast events on other sessions
- Response is the final reply

**session.list** works for discovery.
**`gateway.ready`** arrives on WS connect with skin info — good liveness check.

## Verified working test path (as of this session)

1. POST /api/auth/ws-ticket with Bearer token → 200, ticket
2. WS /api/ws?ticket=... → UPGRADED, gateway.ready frame
3. Send session.list → got real session list
4. Send prompt.submit → pending (test was interrupted before full roundtrip was observed but token+ticket+auth path fully verified)

## Kiosk image (Xorg + Chromium kiosk mode, /dev/dri passthru)

```dockerfile
FROM debian:bookworm-slim
RUN echo 'deb http://deb.debian.org/debian bookworm-backports main' >> /etc/apt/sources.list
RUN apt-get update && apt-get install -y --no-install-recommends \
    xserver-xorg-core xserver-xorg-video-fbdev xserver-xorg-input-libinput \
    openbox chromium x11-xserver-utils xinit fonts-noto-core libgl1-mesa-dri \
    && rm -rf /var/lib/apt/lists/*
ENV KIOSK_URL=http://localhost:8644/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

entrypoint.sh:
```bash
#!/bin/sh
Xorg :0 vt1 -s 0 -dpms -nolisten tcp -config /etc/X11/xorg-simple.conf &
sleep 4
export DISPLAY=:0
xset s off && xset -dpms && xset s noblank
openbox --sm-disable &
sleep 1
exec chromium --kiosk --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --disable-infobars "$KIOSK_URL"
```

xorg-simple.conf (modesetting driver, HDMI-A-2 connector):
```
Section "Device"
    Identifier "Intel"
    Driver     "modesetting"
EndSection
Section "Monitor"
    Identifier "HDMI-A-2"
    Option     "PreferredMode" "auto"
EndSection
Section "Screen"
    Identifier "Default"
    Device     "Intel"
    Monitor    "HDMI-A-2"
EndSection
Section "ServerLayout"
    Identifier "Default"
    Screen     0 "Default" 0 0
    Option     "AutoAddDevices" "true"
EndSection
```

Run:
```bash
docker build -t hermes-kiosk:latest /opt/data/kiosk/kiosk-image
docker run -d --name hermes-kiosk --restart unless-stopped \
    --network host \
    --device /dev/dri \
    --device /dev/fb0 \
    --device /dev/tty7 \
    --device /dev/input/event6 --device /dev/input/event7 \
    -e KIOSK_URL=http://localhost:8644/ \
    -v /sys:class/drm ... # not needed with --device dri
    hermes-kiosk:latest
```

`--network host` required so Chromium can reach both 127.0.0.1:8644 (sidecar) and other services.

## Security caveats

- token_probe and everything under /opt/data/kiosk/build were disposable test/scratch files, cleanup on build
- Kiosk image runs with `--network host`, `-no-sandbox`, and /dev/dri access — Pooh was explicitly warned and approved this
- Do NOT put signing secret in the dashboard UI bundle; the sidecar (container with docker.sock) does the minting and ONLY serves the resulting session tickets over LAN on :8644, which is LAN-only
- `--network host` + `-X-Forwarded-*` header spoofing could bypass Origin checks if an attacker is on the LAN; acceptable here because the whole box is ALREADY LAN-trusted (this is Pooh's own homelab)

## Stats sources verified this session

- host /proc, /sys readable FROM CONTAINER WITH --network host (no extra mounts needed)
- `/var/run/docker.sock` reachable from sidecar container in host netns + docker.sock bind
- docker ps gives per-container health: pihole/ollama/prowlarr/vaultwarden/whisper-stt healthy, deluge web UI down (real)
- Plex sessions endpoint works with token from `/config/Library/Application Support/Plex Media Server/Preferences.xml` (read inside container)
- Plex currently playing probe returns parse-able XML (currently 0 sessions)
- Deluge web UI port 8112 is NOT listening inside the container — DOWN, unrelated to kiosk work; flagging to Pooh as a separate issue to fix later
- Pi-hole stats live at `http://192.168.0.78:8800/api/stats/summary?X-FTL-SID=<sid>`; auth via `/api/auth` POST with password
- Radarr queue page = {page,pageSize,totalRecords,records}; radarr totalRecords 0 right now (fine!)
- Radarr/sonarr API keys live in `/config/config.xml` inside containers