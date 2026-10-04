#!/bin/sh
# Kiosk display entrypoint: X on the console VT, Chromium fullscreen above it.
# ponytail: no window-manager eye candy (openbox = smallest WM that works),
# no touch handling — inputs attached today are mouse + keyboard.
rm -f /tmp/.X0-lock /tmp/.X11-unix/X0 2>/dev/null
# kill stale http cache so the wall never boots on yesterday's HTML (no-store covers future, this covers old entries)
rm -rf /root/.config/chromium/'"'Default"'"/Cache /root/.config/chromium/'"'Default"'"/'"'Code Cache"'" 2>/dev/null || true
Xorg :0 vt1 -s 0 -dpms -nolisten tcp &
sleep 6
export DISPLAY=:0
# ponytail: panel EDID drops out when the monitor is off/X restarts → X falls back to
# 640x480 and the panel upscales everything (wall "too big"). Force native 1366x768.
try_fix_modes() {
  # active-mode check: only the CURRENT mode gets '*'; a listed-but-unapplied mode doesn't
  if xrandr 2>/dev/null | awk '$1=="1366x768_60" && /\*/ {f=1} END{exit !f}'; then return 0; fi
  xrandr --newmode "1366x768_60" 85.25 1366 1440 1576 1792 768 771 774 798 +hsync +vsync 2>/dev/null || true
  for o in $(xrandr 2>/dev/null | awk '/ connected/ {print $1}'); do
    xrandr --addmode "$o" 1366x768_60 2>/dev/null || continue
    xrandr --output "$o" --mode 1366x768_60 2>/dev/null || true
  done
}
# boot fix: X needs a beat before the connector list is real — retry ~1 min
for i in $(seq 1 20); do try_fix_modes && break; sleep 3; done
# enforcer: EDID drops (panel sleep, monitor off, re-seat) revert X to 640x480 later →
# keep enforcing native mode forever at 15s cadence; F5 chromium so it refits.
( while true; do
    if ! xrandr 2>/dev/null | awk '$1=="1366x768_60" && /\*/{f=1} END{exit !f}'; then
      try_fix_modes >/dev/null 2>&1
      sleep 2
      DISPLAY=:0 xdotool key F5 2>/dev/null
    fi
    sleep 15
  done ) >/dev/null 2>&1 &
xset s off
xset -dpms
xset s noblank
openbox --sm-disable &
sleep 1
exec chromium --kiosk --no-sandbox --disable-dev-shm-usage \
    --use-gl=angle --use-angle=vulkan --ignore-gpu-blocklist --enable-gpu-rasterization \
    --touch-events=enabled --no-first-run --disable-infobars \
    --disable-session-crashed-bubble --hide-crash-restore-bubble \
    --enable-logging=stderr --v=0 \
    "$KIOSK_URL"
