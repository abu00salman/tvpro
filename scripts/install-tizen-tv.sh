#!/usr/bin/env bash
# One-shot installer: downloads the latest TV Pro Tizen build from the
# GitHub Release and installs it on a Samsung Smart TV over the network.
#
# Requirements (one-time):
#   - Developer Mode enabled on the TV, with this computer's IP registered
#     (Apps app -> type 12345 on the remote -> enable Developer mode -> enter
#     this computer's IP -> restart the TV).
#   - Tizen Studio installed on this computer (provides the "sdb" tool).
#     https://developer.tizen.org/development/tizen-studio/download
#
# Usage:
#   ./install-tizen-tv.sh <TV_IP_ADDRESS>

set -euo pipefail

TV_IP="${1:-}"
if [ -z "$TV_IP" ]; then
  echo "Usage: $0 <TV_IP_ADDRESS>"
  echo "Find the TV's IP under Settings > General > Network > Network Status."
  exit 1
fi

# Locate sdb from a standard Tizen Studio install.
SDB=""
for candidate in \
  "$HOME/tizen-studio/tools/sdb" \
  "/Applications/Tizen Studio.app/Contents/tools/sdb" \
  "$HOME/Library/tizen-studio/tools/sdb"; do
  if [ -x "$candidate" ]; then
    SDB="$candidate"
    break
  fi
done
if [ -z "$SDB" ]; then
  if command -v sdb >/dev/null 2>&1; then
    SDB="$(command -v sdb)"
  else
    echo "Could not find 'sdb'. Install Tizen Studio first:"
    echo "  https://developer.tizen.org/development/tizen-studio/download"
    exit 1
  fi
fi
echo "Using sdb: $SDB"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
WGT_PATH="$WORKDIR/TV-Pro-samsung-tv.wgt"

echo "Downloading the latest TV Pro Tizen build..."
curl -fsSL -o "$WGT_PATH" \
  "https://github.com/abu00salman/tvpro/releases/download/app-v1.0.0/TV-Pro-samsung-tv.wgt"

echo "Connecting to TV at $TV_IP..."
"$SDB" connect "$TV_IP"

echo "Installing..."
"$SDB" install "$WGT_PATH"

echo "Done. Find 'TV Pro' in the TV's app list (under Developer Mode apps)."
