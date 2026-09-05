#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE is required}"

umask 077
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain="$BACKUP_DIR/jm-wpbot-$timestamp.sql.gz"
encrypted="$plain.gpg"

cleanup() { rm -f "$plain"; }
trap cleanup EXIT

pg_dump "$DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$plain"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --symmetric --cipher-algo AES256 --output "$encrypted" "$plain"
rm -f "$plain"

sha256sum "$encrypted" > "$encrypted.sha256"

find "$BACKUP_DIR" -type f -name 'jm-wpbot-*.sql.gz.gpg' -mtime +"${BACKUP_RETENTION_DAYS:-35}" -delete
find "$BACKUP_DIR" -type f -name 'jm-wpbot-*.sql.gz.gpg.sha256' -mtime +"${BACKUP_RETENTION_DAYS:-35}" -delete

echo "backup=$encrypted"
echo "sha256=$encrypted.sha256"
