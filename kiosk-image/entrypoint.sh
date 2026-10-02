#!/bin/sh
# Kiosk display entrypoint: X on the console VT, Chromium fullscreen above it.
# ponytail: no window-manager eye candy (openbox = smallest WM that works),
# no touch handling — inputs attached today are mouse + keyboard.
Xorg :0 vt1 -s 0 -dpms -nolisten tcp &
sleep 4
export DISPLAY=:0
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