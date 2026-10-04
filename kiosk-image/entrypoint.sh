#!/bin/sh
# Kiosk display entrypoint: X on the console VT, Chromium fullscreen above it.
# ponytail: no window-manager eye candy (openbox = smallest WM that works),
# no touch handling — inputs attached today are mouse + keyboard.
Xorg :0 vt1 -s 0 -dpms -nolisten tcp &
sleep 4
export DISPLAY=:0
# ponytail: panel EDID drops out when the monitor is off/X restarts → X falls back to
# 640x480 and the panel upscales everything (wall "too big"). Force native 1366x768.
if ! xrandr | grep -q '1366x768'; then
  xrandr --newmode "1366x768_60" 85.25 1366 1440 1576 1792 768 771 774 798 +hsync +vsync 2>/dev/null || true
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
    --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
    --touch-events=enabled --no-first-run --disable-infobars \
    --disable-session-crashed-bubble --hide-crash-restore-bubble \
    --enable-logging=stderr --v=0 \
    "$KIOSK_URL"