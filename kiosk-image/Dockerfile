FROM debian:bookworm-slim
RUN echo 'deb http://deb.debian.org/debian bookworm-backports main' >> /etc/apt/sources.list
RUN apt-get update && apt-get install -y --no-install-recommends \
    xserver-xorg-core xserver-xorg-input-libinput xserver-xorg-video-fbdev \
    openbox chromium x11-xserver-utils xinit fonts-noto-core \
    && apt-get install -y -t bookworm-backports libgl1-mesa-dri \
    && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
COPY xorg.conf /etc/X11/xorg.conf
RUN chmod +x /entrypoint.sh
ENV KIOSK_URL=http://127.0.0.1:8644/
ENTRYPOINT ["/entrypoint.sh"]