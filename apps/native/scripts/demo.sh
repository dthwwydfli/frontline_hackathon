#!/usr/bin/env bash
#
# One command for the hotspot demo: picks the right network interface, starts
# the relay, and starts Metro pinned to the same address.
#
#   ./scripts/demo.sh
#
# The laptop must already be joined to the phone hotspot. Tunnel mode is
# deliberately NOT used — a tunnel carries the app bundle but not the relay
# port, so phones would load the UI and then fail to mesh.

set -euo pipefail

cd "$(dirname "$0")/.."

RELAY_PORT="${RELAY_PORT:-17833}"

# Prefer a hotspot address if one exists. iOS hands out 172.20.10.x; Android
# usually 192.168.4x.x. Otherwise fall back to whatever en0 has.
find_ip() {
  for iface in $(ipconfig getiflist 2>/dev/null || echo "en0 en1"); do
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    [ -z "$ip" ] && continue
    case "$ip" in
      172.20.10.*|192.168.4[0-9].*) echo "$ip"; return 0 ;;
    esac
  done
  for iface in en0 en1 en2; do
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    [ -n "$ip" ] && { echo "$ip"; return 0; }
  done
  return 1
}

HOST="$(find_ip)" || { echo "No network address found. Join the hotspot first."; exit 1; }

case "$HOST" in
  172.20.10.*) NETWORK="iPhone hotspot" ;;
  192.168.4[0-9].*) NETWORK="Android hotspot" ;;
  *) NETWORK="Wi-Fi (may block device-to-device traffic)" ;;
esac

echo "────────────────────────────────────────────"
echo " Common Thread demo"
echo " Network : $NETWORK"
echo " Host    : $HOST"
echo " Relay   : ws://$HOST:$RELAY_PORT"
echo "────────────────────────────────────────────"
echo

# Metro must advertise the hotspot address, not whatever it guesses first.
export REACT_NATIVE_PACKAGER_HOSTNAME="$HOST"
export RELAY_PORT

cleanup() { kill "${RELAY_PID:-0}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

node relay/server.js &
RELAY_PID=$!

sleep 1
npx expo start --go --clear
