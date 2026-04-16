#!/bin/bash
# Start Xvfb (virtual framebuffer) for headless Electron.
# Electron needs a display even when running in dev mode without visible UI.

DISPLAY_NUM="${1:-99}"
export DISPLAY=":${DISPLAY_NUM}"

if ! pgrep -x Xvfb > /dev/null; then
  Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
  sleep 1
  echo "Xvfb started on display :${DISPLAY_NUM}"
else
  echo "Xvfb already running on display :${DISPLAY_NUM}"
fi
