#!/bin/sh
# Launch both kiosk containers. Idempotent: removes old instances first.
set -e
docker rm -f stats-sidecar 2>/dev/null || true
docker rm -f hermes-kiosk 2>/dev/null || true

docker network connect hermes-next-pilot-net stats-sidecar --alias stats-sidecar 2>/dev/null || true

# sidecar: host netns for /proc + LAN service probing; binds config + docker socket
# + dashboard HTML (host path: this container's /opt/data = host /DATA/AppData/hermes-next-pilot)
docker run -d --name stats-sidecar --restart unless-stopped \
    --network host --env-file kiosk/usage.env \
    -v /DATA/AppData/hermes-next-pilot/config.yaml:/opt/data/config.yaml:ro \
    -v /DATA/AppData/hermes-next-pilot/kiosk/dashboard:/opt/data/kiosk/dashboard:ro \
    -v /var/run/docker.sock:/var/run/docker.sock \
    hermes-dashboard:v1

# kiosk display: takes over the console; needs /dev/dri for the Intel iGPU
# (Xorg modesetting); privileged is the community-proven shortcut for input
# + VT access. Owner approved this trade-off.
# /run/udev bind: libinput needs the host udev database or Xorg gets ZERO input devices.
docker run -d --name hermes-kiosk --restart unless-stopped \
    --privileged --network host \
    -e KIOSK_URL=http://127.0.0.1:8644/v3/ \
    -v /run/udev:/run/udev:ro \
    hermes-kiosk:v1

echo "launched. give the display ~20s to come up."
