#!/usr/bin/env bash
# Rebuild and restart the production server, then PROVE the build is fresh.
#
# Why this exists: three separate debugging sessions were spent on a server that
# was serving a build older than the source. `next start` does not rebuild, so
# editing lib/ and restarting shows old behaviour in every test. This script
# compares the newest source mtime against .next/BUILD_ID and refuses to report
# success when the build is stale.
#
# Usage:  ./scripts/restart.sh          build + restart
#         ./scripts/restart.sh --fast   restart only, still checks freshness
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
LOG="${LOG:-/tmp/reel-prod.log}"

echo "== stopping anything on :$PORT"
lsof -ti:"$PORT" -sTCP:LISTEN | xargs -r kill 2>/dev/null || true
sleep 1

if [ "${1:-}" != "--fast" ]; then
  echo "== building"
  if ! npm run build > /tmp/reel-build.log 2>&1; then
    echo "BUILD FAILED — last 30 lines:"
    tail -30 /tmp/reel-build.log
    exit 1
  fi
  echo "   build ok"
fi

echo "== starting"
nohup npx next start -H 0.0.0.0 -p "$PORT" > "$LOG" 2>&1 &
for _ in $(seq 1 40); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/api/status" > /dev/null 2>&1; then break; fi
  sleep 0.5
done

# Freshness proof: newest source file must be older than the build artifact.
NEWEST_SRC=$(find app lib components -type f \( -name '*.ts' -o -name '*.tsx' \) -newer .next/BUILD_ID 2>/dev/null | head -5)
if [ -n "$NEWEST_SRC" ]; then
  echo "!! STALE BUILD — these files are newer than .next/BUILD_ID:"
  echo "$NEWEST_SRC" | sed 's/^/     /'
  echo "   (run without --fast to rebuild)"
  exit 2
fi

echo "== fresh"
curl -s -m 5 "http://127.0.0.1:$PORT/api/status"; echo
echo "   build: $(cat .next/BUILD_ID) at $(date -r .next/BUILD_ID '+%H:%M:%S')"
