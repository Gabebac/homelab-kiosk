# homelab-kiosk

Wall-mounted kiosk for the ZimaOS homelab box (192.168.0.78): a physical HDMI
monitor showing a live stats dashboard + a talking Hermes avatar, with a
chat composer wired to the Hermes gateway.

![status](https://img.shields.io/badge/status-live-brightgreen)

## Architecture

Two containers, one launcher:

```
┌─────────────────────┐         ┌──────────────────────────┐
│   hermes-kiosk      │  HTTP   │     stats-sidecar        │
│ Debian + Xorg +     │────────▶│  python-slim + FastAPI   │
│ Chromium --kiosk    │  :8644  │                          │
│ (owns HDMI,         │         │  /       dashboard page  │
│  --network host,    │         │  /stats  aggregated JSON │
│  --privileged)      │         │  /ask    gateway proxy   │
└─────────────────────┘         └──────────────────────────┘
                                   │ docker.sock, /proc,
                                   │ Pi-hole/Plex/*arr APIs,
                                   │ Hermes gateway WS
                                   ▼
                            homelab services on the box
```

- **stats-sidecar** (`hermes-dashboard:v1`) — FastAPI on :8644, `--network host`.
  Aggregates host stats (host /proc), container health (docker socket API),
  Pi-hole v6, Plex now-playing, Radarr/Sonarr queues, and TCP service probes.
  `POST /ask` opens a two-hop-auth WebSocket to the Hermes gateway
  (`ws-ticket` → `?ticket=` on `/api/ws`, `prompt.submit` JSON-RPC, streaming
  deltas collected to a terminal event), so the avatar's answers have full
  Hermes memory + skills.
- **hermes-kiosk** (`hermes-kiosk:v1`) — Debian + Xorg modesetting + openbox +
  Chromium `--kiosk`, `--network host --privileged`, owns the HDMI output.

## Deploy

Images must be built first (`build/` holds the two Dockerfiles + kiosk image
tree), then:

```sh
sh run-kiosk.sh
```

Rebuild the sidecar after a `sidecar.py` change:

```sh
docker build -f sidecar-Dockerfile -t hermes-dashboard:v1 .
docker rm -f stats-sidecar && sh run-kiosk.sh
```

Dashboard UI changes (`dashboard/index.html`) are bind-mounted read-only —
live on page reload, no image rebuild. Chromium does not auto-reload:
recreate `hermes-kiosk` to see changes.

## Design

The dashboard uses the **Olympus design system** (theme `aether`): deep-sea
surfaces, corona-cyan accent, LED status dots with rim+glow, Tilt Neon
display / Alata body type. Sized for a 1366×768 wall panel.

## Operational notes

(Learned the hard way — each cost a debug pass.)

- **Input devices need `/run/udev`.** Without `-v /run/udev:/run/udev:ro`,
  libinput can't classify devices and Xorg starts with zero inputs — frozen,
  cursor-less wall that *looks* like a browser hang.
- **`docker restart hermes-kiosk` can crash-loop.** A killed Xorg leaves
  `/tmp/.X0-lock` in the writable layer → `Server is already active for
  display 0` → Chromium exits → restart loop → black screen. Fix: recreate
  the container (`docker rm -f` + run), which resets `/tmp`.
- **Launcher is the source of truth.** Fixes applied via bare `docker run`
  are erased next time `run-kiosk.sh` runs. Patch the launcher, then re-run.
- **Pi-hole v6 rate-limits auth.** The sidecar mints a session per poll →
  HTTP 429. It now caches the `X-FTL-SID` for 1500 s (TTL 1800), and each
  `/stats` source degrades to `null` instead of failing the whole page.
- **Credentials are read at runtime**, never baked into images: Pi-hole
  `cli_pw`, Plex `PlexOnlineToken`, *arr ApiKeys from read-only AppData
  binds; auth is not stored in this repo.

## Files

| Path | What |
|---|---|
| `sidecar.py` | FastAPI sidecar: `/`, `/stats`, `/ask` |
| `sidecar-Dockerfile` | sidecar image |
| `dashboard/index.html` | the wall UI (bind-mounted, no rebuild) |
| `run-kiosk.sh` | idempotent launcher: removes + recreates both containers |
| `health-probe.sh` | quick page/stats probe |
| `build/` | kiosk image build tree (kiosk-Dockerfile, etc.) |
| `PROTOCOL.md` | full gateway auth + poll protocol notes |