# HUNLAB KIOSK — AGENT HANDOFF

> Read this before touching anything. Repo: https://github.com/Gabebac/homelab-kiosk · owner: Pooh (Gabebac).

## What this is
Wall-mounted 16" kiosk (1366×768 native) on ZimaOS box **192.168.0.78**: live homelab stats + Live2D avatar + chat + calendar, one single-file vanilla dashboard.

## Architecture
- `dashboard/v3/index.html` — THE wall. Single-file vanilla (no React/Tailwind/frameworks — policy). `html{zoom:0.92}` stays.
- `sidecar.py` — FastAPI on :8644. Endpoints `/stats /ecoflow /plexreqs /usage /ask` (+`/starlink` residue). `/ask` → WS to gateway container `hermes-next-pilot` (port 9119), `ask_hermes_streaming` → `prompt.submit` (+ `session.create` model param for the chat model picker). 120s wall abort + 300s WS timeout.
- Feeds: `dishfeed.py` (Starlink, 15s → v3/starlink.json), `cronfeed.py` (cron+jobs.json → events.json), EcoFlow HMAC poll, Pi-hole, Plex/Radarr/Sonarr.
- Containers: `hermes-kiosk` (Chromium, X :0, `KIOSK_URL=http://127.0.0.1:8644/v3/`), `stats-sidecar`, `hermes-next-pilot` (gateway).

## Run / deploy / verify
- Run: `docker run -d --name hermes-kiosk --restart unless-stopped --privileged --network host -e KIOSK_URL=http://127.0.0.1:8644/v3/ -v /run/udev:/run/udev:ro hermes-kiosk:v1`
- Code-only deploy: `docker cp sidecar.py stats-sidecar:/app/sidecar.py && docker restart stats-sidecar` (momentary feed blackout ~5s, normal).
- Env changes: `./run-kiosk.sh --env-file /opt/data/kiosk/usage.env` (recreates sidecar). usage.env is gitignored, holds API keys — NEVER commit or print.
- Reload wall: `docker exec hermes-kiosk sh -c 'DISPLAY=:0 xdotool key F5'`
- Capture (native): `docker exec hermes-kiosk sh -c "DISPLAY=:0 xwd -root -silent > /tmp/r.xwd && convert /tmp/r.xwd /tmp/r.png"; docker cp hermes-kiosk:/tmp/r.png .`
- Headless verify: in-container `chromium --headless --no-sandbox --user-data-dir=/tmp/hlX$$ --window-size=1366,768 --screenshot=… http://192.168.0.78:8644/v3/` (or CDP: `--remote-debugging-port=9333`, probe `http://127.0.0.1:9333/json` FROM INSIDE the container, raw-socket WS — no websockets pkg).
- Commits: `git -c user.name='Gabebac' -c user.email='gabebac@users.noreply.github.com' commit`; push after sourcing `/opt/data/.env` for GITHUB_TOKEN.
- JS parse gate: `node --input-type=commonjs -e "new Function(s)"` on extracted <script> (`node --check` false-passes — TS-strip).

## House policies (user-verbatim, non-negotiable)
- **NO glow** on cards — neutral black depth shadows; mint/slate palette.
- **Equal-height wall, no scroll** — `main{overflow:hidden}`; never regress.
- **Ring gauges only** — all bar graphs banned (V4.3); Brik ring instances allowed.
- **Fusion fidelity** — animated/graph effects must be verbatim ports ("why you keep doing the lazy version of the ring graph i gave you?"). Static stand-ins are rejected.
- **Vanilla-port rule** — React/Tailwind/framer attachments must be hand-rolled with the same motion (Brik + orbs + chat picker precedent). Motion tokens for pickers: EASE [0.2,0,0,1], spring 420/32, press 500/28.
- **Boards (Figma file aBmUGgcsBwEc1XUzFK8OZX)** — per-element segments + empty tweak lanes; user makes copies with tweaks, implement only on their signal. Forward-only: every version gets a wall frame + changelog, never backfill old eras.
- **Repo doc rule** — "make sure you document everything we are doing in the Homelab Kiosk repo" — README table + CHANGELOG per version, tag + push every version.
- **Version counter** — bump `Pooh's HunLab · kiosk vX` in the page header every change (currently v7.6).
- **Cursor SCRAPPED** (V5.7) — OS pointer; never reintroduce.
- **Native-res only** — verify at 1366×768 (xrandr modeline baked in entrypoint.sh); never judge at 800×600.
- **Privacy** — never print credential values in chat or repo; they live in /opt/data/.env, usage.env, Figma/Radarr/json files on disk.

## Version lineage (V1→V7.6)
Full table in README (`## design history`); per-version details in CHANGELOG.md. Highlights:
- V4.x: verbatim Brik ring port + governors (8fps idle/30fps settling; `bootBrik(hostSel)` + per-instance KEYMAP).
- V5.x: chat strip → thinking orbs → overlay-first chat → perf pass → native-res → SL DOWN/UP + usage card.
- V6.x: bigger rings/battery/avatar, chat-history-on-wall (HERMES·CHAT card + wallhist mirror via MutationObserver on REPLY=#drmsgs), week schedule, send fixes.
- V7.x: 24-col grid, #morphover overlay REQUIRED by ask() (missing div broke send), margins 28px, chat model picker, calendar flip removed, bottom flush.

## Known traps (do not relearn these)
1. **Silent-edit bug class** — edits have NOT landed on disk 5+ times. ALWAYS verify every edit: re-read/re-grep the file after writing.
2. **`#morphover` div must exist** — ask() does `ov.querySelector` right after echoing the bubble; missing → send dead forever.
3. **Avatar picker overlap** — anything pinned over the pill row swallows send clicks; avtab pinned flush bottom-right under avatar card, keep it clear of the chat pill.
4. **Brik 2-ring chart** — segments are 1–2; SL keymap maps down→val1, up→val2 with activeSegments===2.
5. **events.json field is `last`** (not last_status). Calendar flip REMOVED (V7.5); week schedule card is the info home.
6. **/ask latency** — gateway spawns a full agent turn; can take minutes when "busy compacting contexts". 120s abort surfaces "gateway timeout — try again".
7. **Socket timeouts** — sidecar WS create_connection(300s); 10s idle kills cold-model turns.
8. **dishfeed dies on reboot** — rebuild: `cd /opt/data/kiosk/starlink-grpc-tools && setsid nohup .venv/bin/python /opt/data/kiosk/dishfeed.py >> /opt/data/kiosk/dishfeed.log 2>&1 < /dev/null &`
9. **Capture tools vanish** after container recreate: `apt-get update -qq && apt-get install -y x11-apps imagemagick xdotool`.
10. **Figma get_screenshot of a FRAME returns frame content** — page layout checks need the page-level render (nodeId 0:1).

## Current state (V7.6, 5281d97)
- 24-col grid, rows 2fr 1fr 1fr 1fr. Top: sys 6 | sl 6 | usage 6 | cal 6 (sys/sl/usage/cal tall; SL grew down w/ latency/uptime/state).
- Middle: eco 6 (battery 150px waving mint fill) | plex 6 (cols 13-18) | week 6 (cols 19-24).
- Bottom: chat 17/24 (HERMES·CHAT, pill inside: spark+input+model pill+send; wallhist mirror) | avatar 7/24 (Live2D, `#avatar` 240px, models ren/kei/rice/jinx via `?av=`).
- Chat model picker: AUTO▾ pill + dropdown (auto/glm/kimi/gpt-oss/minimax/deepseek), localStorage, model passed via gateway session.create.
- Thinking overlay #morphover: dim + dotted orb + centered label.
- Avtab pinned flush bottom-right under avatar card (inset 28px margin).

- V8.1.1 display enforcer: permanent 15s modeline restore + F5 in entrypoint.sh (EDID drops when monitor sleeps). Vulkan ANGLE GPU, NOT swiftshader.

## Open threads
- /ask still slow by gateway nature (full agent turn); fine per 120s timeout.
- Figma: per-version wall frames beyond V7.6 = add going forward only. Segments block (52:6) + Tweak lanes remain for user-driven edits.
- Thinking-trace expandable rows — parked unless user revives.
- V8.1.1: Chromium runs Vulkan ANGLE on the Intel iGPU (NOT swiftshader) — container steady ~75% (was 344% software WebGL). Live2D 30fps cap + Brik 16ms/125ms governors. entrypoint.sh has a PERMANENT display enforcer (15s): restores the 1366×768 modeline after EDID drops (monitor off/sleep) and F5s the wall — don't strip it; a lost --newmode line once made addmode fail silently.
