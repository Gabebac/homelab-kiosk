#!/bin/sh
# Kiosk display entrypoint: X on the console VT, Chromium fullscreen above it.
# ponytail: no window-manager eye candy (openbox = smallest WM that works),
# no touch handling — inputs attached today are mouse + keyboard.
Xorg :0 vt1 -s 0 -dpms -nolisten tcp &
sleep 6
export DISPLAY=:0
# ponytail: panel EDID drops out when the monitor is off/X restarts → X falls back to
# 640x480 and the panel upscales everything (wall "too big"). Force native 1366x768.
xrandr --newmode "1366x768_60" 85.25 1366 1440 1576 1792 768 771 774 798 +hsync +vsync 2>/dev/null || true
try_fix_modes() {
  if xrandr 2>/dev/null | grep -q '1366x768_60'; then return 0; fi
  for o in $(xrandr 2>/dev/null | awk '/ connected/ {print $1}'); do
    xrandr --addmode "$o" 1366x768_60 2>/dev/null && xrandr --output "$o" --mode 1366x768_60 2>/dev/null || true
  done
}
# X needs a beat before the connector list is real; retry a few times (lost the race once, fell back to 640x480)
for i in 1 2 3 4 5; do try_fix_modes && break; sleep 2; done
if ! xrandr | grep -q '1366x768_60'; then
  for o in $(xrandr | awk '/ connected/ {print $1}'); do
    xrandr --addmode "$o" 1366x768_60 2>/dev/null && xrandr --output "$o" --mode 1366x768_60 2>/dev/null || true
  done
fi
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