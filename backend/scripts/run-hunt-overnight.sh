#!/bin/bash
# Restarts hunt-diversity.ts until cumulative sampled count hits TARGET.
# hunt-diversity.ts resumes from its own prior output file on each start,
# so a crash/kill mid-run just costs the time since the last flush
# (every 20k samples), not the whole run.
cd "$(dirname "$0")/.."
TARGET=10000000
RESULTS_FILE=hunt-diversity-results.json

get_sampled() {
  node -e "try { console.log(JSON.parse(require('fs').readFileSync('$RESULTS_FILE','utf8')).sampled) } catch { console.log(0) }"
}

while true; do
  sampled=$(get_sampled)
  echo "[$(date '+%H:%M:%S')] Current sampled=$sampled / target=$TARGET"
  if [ "$sampled" -ge "$TARGET" ]; then
    echo "[$(date '+%H:%M:%S')] Target reached. Stopping."
    break
  fi
  echo "[$(date '+%H:%M:%S')] Starting/restarting hunt-diversity…"
  HUNT_SAMPLES=$TARGET npx tsx --env-file=.env scripts/hunt-diversity.ts
  echo "[$(date '+%H:%M:%S')] Process exited (code $?). Checking progress before restart…"
  sleep 5
done
