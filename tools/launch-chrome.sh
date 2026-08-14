#!/usr/bin/env bash
# Launch a debuggable Chrome on an isolated profile.
# Chrome >=136 refuses --remote-debugging-port on the default profile, so this
# uses its own user-data-dir at /tmp/aeo-debug-profile. Log in to the AI sites
# once inside this window; the profile persists between runs.
set -euo pipefail

PROFILE="${AEO_PROFILE:-/tmp/aeo-debug-profile}"
PORT="${AEO_PORT:-9222}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EXT="${AEO_EXT:-}"

mkdir -p "$PROFILE"

ARGS=(
  --remote-debugging-port="$PORT"
  --user-data-dir="$PROFILE"
  --no-first-run
  --no-default-browser-check
  --disable-features=Translate,MediaRouter
  --remote-allow-origins=http://127.0.0.1:"$PORT"
)

if [ -n "$EXT" ]; then
  ARGS+=(--disable-extensions-except="$EXT" --load-extension="$EXT")
fi

echo "launching Chrome: profile=$PROFILE port=$PORT ext=${EXT:-none}"
"$CHROME" "${ARGS[@]}" about:blank >/tmp/aeo-chrome.log 2>&1 &
echo $! > /tmp/aeo-chrome.pid

for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null; then
    curl -s "http://127.0.0.1:$PORT/json/version" | head -c 300
    echo
    echo "ready"
    exit 0
  fi
  sleep 0.5
done
echo "chrome did not expose the debug port" >&2
tail -20 /tmp/aeo-chrome.log >&2
exit 1
