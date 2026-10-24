#!/usr/bin/env bash
# Daily backup for the Docker install. Writes a copy inside the volume, then copies it out to the host.
# Cron example (03:15 every day):  15 3 * * * /opt/twisted-cafe/deploy/backup-docker.sh >> /var/log/twisted-cafe-backup.log 2>&1
set -euo pipefail
CONTAINER="${CONTAINER:-twisted-cafe}"
HOST_DIR="${HOST_DIR:-/var/backups/twisted-cafe}"
KEEP="${KEEP:-30}"

mkdir -p "$HOST_DIR"
out=$(docker exec -e KEEP="$KEEP" "$CONTAINER" node server/backup.js)
echo "$out"
file=$(echo "$out" | sed -n 's/^Backup written: \(\S*\).*/\1/p')
docker cp "$CONTAINER:$file" "$HOST_DIR/"
# Keep the newest $KEEP copies on the host too.
ls -1t "$HOST_DIR"/cafe-*.db 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "Copied to $HOST_DIR/$(basename "$file")"
