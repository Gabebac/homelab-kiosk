# Changelog

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
