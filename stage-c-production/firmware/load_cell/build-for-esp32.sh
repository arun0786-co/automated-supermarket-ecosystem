#!/usr/bin/env bash
# compiles the firmware for a real esp32 in a throwaway container, so platformio doesn't need
# installing. this proves it builds, not that it works: it has never run on a device
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
docker run --rm -v ase-pio-cache:/root/.platformio -v "$HERE:/src:ro" python:3.11-slim bash -c '
  set -e
  pip install -q --root-user-action=ignore --disable-pip-version-check platformio
  cp -r /src /tmp/build && cd /tmp/build
  pio run -e esp32dev 2>&1 | tail -6
'
