# Changelog

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
