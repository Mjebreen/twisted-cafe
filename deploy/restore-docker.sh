#!/usr/bin/env bash
# Put a database file into the Docker volume (first move from Windows, or restoring a backup).
# Usage: deploy/restore-docker.sh path/to/cafe.db
# This REPLACES the current database. A safety copy of the current one is kept in the volume first.
set -euo pipefail
SRC="${1:?Usage: $0 path/to/cafe.db}"
CONTAINER="${CONTAINER:-twisted-cafe}"
VOLUME="${VOLUME:-$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")}"
[ -f "$SRC" ] || { echo "No file: $SRC"; exit 1; }
[ -n "$VOLUME" ] || { echo "Could not find the /data volume of $CONTAINER"; exit 1; }

echo "Stopping $CONTAINER…"
docker stop "$CONTAINER" >/dev/null
docker run --rm -v "$VOLUME":/data -v "$(cd "$(dirname "$SRC")" && pwd)":/in:ro alpine sh -c "
  set -e
  if [ -f /data/cafe.db ]; then mkdir -p /data/backups && cp /data/cafe.db /data/backups/before-restore-\$(date +%Y%m%d-%H%M%S).db; fi
  rm -f /data/cafe.db-wal /data/cafe.db-shm
  cp /in/$(basename "$SRC") /data/cafe.db
  chown -R 1000:1000 /data
"
docker start "$CONTAINER" >/dev/null
echo "Restored $SRC into volume $VOLUME and restarted $CONTAINER."
