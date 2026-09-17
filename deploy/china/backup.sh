#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="backups/renewal-$stamp.sql"
# Full database includes Auth identities and subscription/reminder state. Contains personal data.
docker compose --project-directory upstream/docker exec -T db pg_dump -U postgres --clean --if-exists postgres > "$destination.tmp"
test -s "$destination.tmp"
mv "$destination.tmp" "$destination"
printf 'Backup saved: %s\n' "$destination"
