#!/bin/bash
# Fetch Led Zeppelin album data from Discogs (from this Mac's own connection) and push it to ledzeppelin.app.
# Run by launchd every 5 hours (see install.sh). Discogs' API Terms forbid showing data older than 6 hours;
# the site keeps each push for 5.5 hours, so if this Mac is off the album pages fall back to Discogs links.
set -uo pipefail
DIR="$HOME/.config/ledzeppelin-discogs"
TOKEN="$(cat "$DIR/token" 2>/dev/null)"
[ -n "$TOKEN" ] || { echo "$(date '+%F %T') no token in $DIR/token"; exit 1; }
SITE="https://ledzeppelin.app"
UA="LedZeppelinApp/1.1 +https://ledzeppelin.app"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ok=0; fail=0

push() { # kind id discogs-path
  code=$(curl -sS --max-time 60 -A "$UA" -H "Authorization: Discogs token=$TOKEN" "https://api.discogs.com$3" -o "$TMP/d.json" -w "%{http_code}")
  if [ "$code" != "200" ]; then
    fail=$((fail+1)); echo "$(date '+%F %T') Discogs said $code for $1 $2"
  else
    code=$(curl -sS --max-time 60 -X POST -H "x-ingest-token: $TOKEN" -H "content-type: application/json" \
         --data-binary @"$TMP/d.json" "$SITE/api/discogs-ingest?kind=$1&id=$2" -o "$TMP/r.txt" -w "%{http_code}")
    if [ "$code" = "200" ]; then ok=$((ok+1)); else fail=$((fail+1)); echo "$(date '+%F %T') site said $code for $1 $2: $(head -c 120 "$TMP/r.txt")"; fi
  fi
  sleep 1.2   # Discogs allows 60 authenticated requests a minute
}

curl -fsS --max-time 30 "$SITE/api/discogs-plan" -o "$TMP/plan.txt" || { echo "$(date '+%F %T') could not reach $SITE"; exit 1; }
while read -r slug master release; do
  [ -n "$master" ] || continue
  push master "$master" "/masters/$master"
  push versions "$master" "/masters/$master/versions?per_page=1"
  push release "$release" "/releases/$release"
done < "$TMP/plan.txt"
echo "$(date '+%F %T') pushed $ok, failed $fail"
