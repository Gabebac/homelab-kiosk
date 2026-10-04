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
## Wall design history (the "boards" line)

Design versions live in the [Figma design file](https://www.figma.com/design/aBmUGgcsBwEc1XUzFK8OZX)
(one 1366×768 wall frame + changelog note per version, forward-only — past eras
are never backfilled). From **V5.4** on, every version also ships a **SEGMENTS
section**: each wall element (system brik, starlink brik, containers, calendar,
ecoflow, plex, chat pill, avatar, cursor, clock/brand) is its own frame with an
empty `timeline` lane underneath — drop tweak copies there and say "i got some
there" and the change gets implemented.

| Version | Commit | What |
|---|---|---|
| V3.x | 934ce89 → f3a4c37 | Olympus → bento layout, arr/plex cards |
| V4.0 | 13a359c | glow purge, mint-slate palette |
| V4.2 | 7d65267 | ring gauges, glow removal from cards |
| V4.3 | d1c9b4f | all bar graphs removed (rings only) |
| V4.5 | 07d6e1b | chat popup |
| V4.6 | 1bec549 | sys fusion card, starlink card |
| V4.9 | e446050 | verbatim animated Brik Radial Chart port |
| V5.0 | 0430815 | equal 4/4/4 rows, SL ring gauge, morph chat pill, containers 13/37 re-spec, cron calendar |
| V5.1 | 3af3583 | vanilla thinking-orbs port (528-dot SVG, per-phase looks) |
| V5.2 | 9359683 | cursor: instant follow (lerp deleted), edges reachable |
| V5.3 | 967b70e | bare chat pill 2/3 width + fullscreen orb overlay before popup, arrow-only model picker |
| **V5.4** | **9144eda** | **perf pass + Starlink Brik ring #2 (below)** |
| V5.5 | d651b4b | rings smaller (sys 178 / sl 150) |
| V5.6 | 26a30a1 | Starlink 2 rings (clamp Math.max(3) relaxed) |
| V5.7 | 1f9ce21 | SL↔ctr swap, middle row split, custom cursor scrapped |
| (fix) | 37e3546 | native 1366×768 xrandr modeline baked into entrypoint.sh (EDID fallback was 640×480) |
| V5.8 | a0e1b4b | SL DOWN/UP % rings, USAGE·PROVIDERS card, sidecar /usage |
| V5.9–V6.0 | 67983dc | avatar upsize + top row 2fr, rings 200/170 |
| V6.1 | 2cc8639 | usage=sl width, 18/10 screen padding, avatar 210px unclamped, picker arrow right |
| V6.2 | db5e64c | battery ring-effect motion fill, containers half width, avatar spans last 2 rows |
| V6.3 | 5a18982 | SL rings 50–100 range + metrics rows, sys/sl equal width |
| V6.4 | a1683cc | usage split (containers under it), chat history wall card replaces popup auto-open |
| V6.7 | 7c1224e | SL keymap respects 2 segments (silent-edit x3 + 50–100 range), battery bright-core shading |
| V6.8 | 7d2ee58 | chat = ONE card (history + input merged), spans last 2 rows |
| V6.9 | a475805 | send unblocked (avtab pinned over it), sys ring 230px, plex halved → WEEK SCHEDULE card, global esc() fixes cal back |
| V7.0/V7.1 | 6e91013 | 24-col grid, battery 250px (reverted later), missing #morphover div = send root cause |
| V7.2 | 8779930 | eco=sys width, plex=ctr width, SL spans into eco row + latency/uptime/state rows, battery back 150px |
| V7.3 | f05fa07 | side margins 28px, chat+avatar stretch, picker pinned flush to avatar card bottom |
| V7.4 | dfd2500 | thinking orb/label centered, SL ring 200px, avatar picker inside margin, CHAT model picker (session.create model), sidecar 300s WS timeout |
| V7.5 | 347915c | calendar flip removed, bottom row 14/10, cards stretch lower |
| **V7.6** | **5281d97** | **CURRENT — bottom flush (main 100%), chat/avatar 17/7 of 24** |

## V5.4 — performance pass (9144eda)

Goal: lag-free wall **without losing any visuals**. Measured on the ZimaOS box
(`docker stats`, idle wall): **~335% → ~209% CPU**.

- **Brik charts (system + starlink)**: render governor — full GL+SDF redraw at
  30fps while values ease, **8fps when settled** (the thermal wave keeps
  breathing; indistinguishable at its actual wave speed).
- **Root cause found — Starlink ring was dead**: the bridge `KEYMAP` only had
  the system keys (`mem/dsk/cpu/ph`), so every `_slSet()` silently no-oped;
  the second ring showed boot seeds forever. `q/down/up/obstr` added; both
  charts animate live now.
- **Avatar**: pixi ticker capped at 30fps (biggest single saving, ≈110%).
- **Hyper-grid background**: redraws only on pointer move/resize (was 60fps).
- **Cursor**: rAF frame skips all work when nothing is hovered.
- Verbatim-port rule intact: both briks keep the internal 300px stage,
  CSS-downscaled; no visual regressions (verified true-res 1366×768).
