# Changelog

## V7.2
- **EcoFlow card = System card width** (6/24, left column aligned).
- **Plex card = Containers card width** (6/24), aligned directly under it.
- **Starlink card grew into the freed gap**: it now spans the tall rows AND the eco row (cols 7–12), with the FULL important stats under the ring — down/up Mb/s, obstruction %, latency (ms), uptime (h), state. Battery bar reverted to 150px.
- Week schedule width untouched.

## V7.0 / V7.1
- **Grid widened to 24 columns** so widths can halve cleanly: EcoFlow = Plex = Plex-half (9/24 each), WEEK SCHEDULE keeps its exact 3/12 width (6/24).
- **Battery widened** (150→250px bar) to fill the resized EcoFlow card.
- **Chat + avatar stretch lower**: main bottom padding 10→4px, avatar-model button bottom-aligned on the same line (bottom:4px).
- **SEND FIXED (root cause)**: the `#morphover` overlay element was missing from the markup — `ask()` threw a TypeError right after echoing the user bubble, so the `/ask` fetch NEVER fired and the send button stayed disabled for all later messages. Restored the div; verified live: click → user bubble + "SEARCHING" orb overlay → turn resolves (short turns ~15s; long agent turns with tool use can run minutes, and a 120s client abort now surfaces 'gateway timeout — try again' in the transcript instead of dead silence).
- Instrumented the sidecar to diagnose the hang: each wall /ask creates a fresh agent session whose turns sometimes run TOOLS (tool.start/complete, sessions.changed events) before answering — that is the multi-minute latency, not a broken socket. Debug stamps removed after the diagnosis.

## V6.9
- **Send button root cause (blocked, not broken)**: the avatar-model button was auto-pinned by `avpin()` to the chat card's right end — right on top of the send arrow — swallowing every click (also explains mystery avatar switches). Avpin neutralized; picker button now fixed at the far bottom-right, under the avatar — "the other side of the model".
- **System ring bigger** (200→230px display) with smaller ring labels (`segLabelSize` 2→1.5).
- **Plex card cut in half** (6→3 cols) → freed half became the **WEEK SCHEDULE** card under the calendar, listing the next 7 days of cron events (live: Gmail inbox assistant, cerebellum-post-upgrade).
- **Calendar flip fixed at the root**: the card's back list used a local `esc()` that only existed inside other closures → template threw and the back stayed at '–'/empty. A global `esc()` helper added; back face now renders events.

## V6.8
- **Chat + text field unified**: one element — the HERMES·CHAT card now spans the full bottom 8-col zone across two rows, carries the input pill (spark + field + send) full-width at the card's bottom, transcript above. Old floating pill card removed. Dropup pin re-anchored to the chat card.
- Send path verified on-wall (typed 'hello wall' → user bubble mirrored into card). Reply latency currently minutes-long: hermes-next-pilot gateway is compacting contexts; same /ask path verified end-to-end in V6.4.

## V6.7
- **Starlink range actually fixed this time**: root cause twofold — the V6.3 50-100 edit never reached disk (silent-edit bug, third occurrence), and the SL bridge's `down/up` keys mapped to val2/val3 while the 2-segment chart displays val1/val2 (so DOWN showed a stale seed sliver). KEYMAP now respects `activeSegments: 2`: down→val1, up→val2. Wall shows DOWN 50 / UP 55, both arcs past half-circle.
- Battery fill: bright core + darker edges (radial highlight + vertical edge shading), ring-style.
- Avatar picker button: right side, above the chat row's right end (was overlapping the containers card at mid-screen height).

## V6.4
- Top block: usage column split in height — USAGE (upper half) + CONTAINERS (lower half); sys/sl/cal stay tall spanning both rows (5-row grid, rows 1-2 for tall cards).
- Chat history now lives ON the dashboard — a 'HERMES · CHAT' card in the old containers spot mirrors the transcript (MutationObserver mirror of the drawer log, auto-scrolls); the popup no longer auto-expands after a reply.

## V6.3
- Starlink rings mapped to a 50–100 range (always ≥ half active; mb/s still shown as text below).
- Metrics rows under the Starlink ring: down/up Mb/s, obstruction, signal.
- Top row = four equal 3/12 cards (sys/sl/usage/cal same width).

## V6.2
- EcoFlow battery bigger (96×44 → 150×64) with ring-chart-style thermal motion ported onto the fill (waving mint gradient, 6s loop).
- Containers card cut to half width (left); avatar now spans the containers row + chat row (right-side) — ~2 rows tall, bottom-aligned.
- `grid-template-areas` row3: ctr×6 · gap · av×4; av card stretches rows 3–4.

## V6.1
- ROOT FIX: usage card rendered half-width — its `grid-area:usage` CSS rule had silently never landed (silent-edit bug again); rule added → equal width with Starlink card.
- Even screen margin (main padding 10/18/10); avatar canvas unclamped 148→210px (the +15% fit bump finally displays) and truly centered (-50%,-50%); model-picker button right side (right:22px, bottom:12px).

## V6.0
- Top card row **2× the height** of the other rows (`grid-template-rows: 2fr 1fr 1fr 1fr`); ring charts upsized to match (sys 178→200, starlink 150→170).
- Usage card: 4s retry after boot race (was showing dashes until first 60s tick).

## V5.9
- Avatar bigger: all Live2D model fit-scales +15% (kei .16→.185, ren .07→.08, rice .068→.078, jinx .085→.098); av-wrap 148→210px.

## V5.8 (live-verified)
- Starlink ring now shows **DOWN / UP speeds** (live, % of nominal 250/50 Mbps).
- Starlink top-row card cut in half width-wise: left = ring, right = new **USAGE · PROVIDERS** card — OpenRouter spend, Ollama Cloud weekly % + request count, ElevenLabs characters, plus Starlink obstruction/signal line.
- Data: new sidecar `/usage` endpoint (keys read from env at runtime — `usage.env`, gitignored, injected via `--env-file` in run-kiosk.sh). Values verified live: OpenRouter $18.93, Ollama 42% wk / 1310 reqs, ElevenLabs 51%.

## V5.7 (native-res, verified live)
- Layout: Starlink card ↔ Containers card swapped (STARLINK now top row middle next to SYSTEM + CALENDAR).
- Second row divided into two middle rows: half-height ECOFLOW + PLEX row, then a full-width CONTAINERS row (4 rows + chat now).
- Cursor effect + custom pointer scrapped: #mcur CSS/JS/markup removed, `cursor:none` lifted (OS pointer again). Hyper-grid keeps its own parallax listeners (self-contained).
- Verified on TRUE live wall at 1366×768 after the X-mode fix.

## ROOT-CAUSE FIX (with V5.6) — display resolution
- The panel's EDID drops out (monitor off / X restart) → Xorg fell back to **640×480**; the panel upscaled that to fill the 16" screen, so the wall rendered ~2.1× bigger physically than in my headless 1366×768 checks — every size divergence traced here.
- `entrypoint.sh` now forces a 1366×768_60 modeline on the connected output when 1366×768 is absent. Verified live: `xrandr` reports 1366×768, native-res capture matches the design.
- Previous "v5.4 smaller rings" etc. may have been over-corrected under the old fallback; ring sizes (178/150) may now read small at true res — recalibrate on your call.

## V5.6
- Starlink ring: 2 segments only (SIG + OBS; down/up stay in the side rows). Enabled 2-slot activeSegments (template clamped at min 3).
- Ring charts smaller: System 212→178px, Starlink 170→150px display (internal 300px stage untouched — labels intact).

## V5.4 (9144eda) — perf pass + Starlink Brik ring #2
- Perf (wall CPU ~335% → ~209% on docker stats, idle):
  - Brik render governor: 30fps while values ease (unchanged look), 8fps settled.
  - Starlink bridge root-cause fix: `_slSet` was silently dropped by the old
    SYS-only `KEYMAP` (`mem/dsk/cpu/ph`) — `q/down/up/obstr` added; the new
    Starlink ring now takes live `starlink.json` values (SIG/DOWN/UP/OBS).
  - Avatar pixi ticker `maxFPS = 30`.
  - Hyper-grid: event-driven redraw (pointer move/resize) instead of 60fps rAF.
  - Cursor rAF skips work when nothing magnetic is hovered.
- Element: Starlink card gains a SECOND verbatim Brik Radial Chart
  (`#slrings`, boot shim seeded from SL values, CSIZE 170 display) beside the
  down/up/obstr rows.
- Boards: Figma V5.4 wall frame (52:5) + SEGMENTS section (52:6) with 10
  per-element segment frames + empty timeline lanes (forward-only policy).
- Verify: parse gate (`new Function`), virtual-time headless runs with
  console checks, true-res screenshots of both brik cards, avatar after cap.

## V5.3 (967b70e)
- Chat: bare pill (no card chrome), 2/3 row width, bottom-aligned with avatar;
  arrow-only circular model picker (`title` tooltip, not textContent).
- Send flow: fullscreen overlay first (dim wall + dotted orb + phase labels),
  popup expands to ~2/3 screen with history after resolve (~29s `/ask`).
- Calendar: content to top, month font 11.5px, 15px cells / 3-4px gaps (full month).

## V5.2 (9359683)
- Cursor: lerp DELETED — pointer pinned instantly (`pos == target` every frame);
  reaches screen bottom; magnetic hover no longer freezes follow; closest() guard.

## V5.1 (3af3583)
- thinking-orbs (`@yogesharc/thinking-orbs`) ported vanilla, TS stripped,
  parse-gated with `node --input-type=commonjs` (`node --check` false-passes on
  TS in Node ≥23). 528-dot SVG sphere; phase→look map (Thinking→reasoning,
  Searching→searching, Analyzing→reasoning-twins, Composing→working).
- `orbTick` / `clockTick` renamed apart (top-level hoisting collision caused NaN orbs).

## V5.0 (0430815 + 8b33457)
- Equal 4/4/4 top & middle rows; rows ~1cm lower; EcoFlow battery 96×44.
- Starlink visualization (dual SVG ring + side rows; superseded by Brik #2 in V5.4).
- Chat pill (spark + input + arrow send) → popup expansion; ✕ close fix.
- Containers: front = 13 important services + warnings; back = all 37.
- Calendar: tighter grid, full month, events from Hermes cron (`cronfeed.py`).

## V4.9 (e446050 / 4e7416a)
- Verbatim Brik Radial Chart port (WebGL2 thermal SDF; telemetry stripped);
  transparent GL seam fix; internal 300px stage displayed at 212px via CSS.
