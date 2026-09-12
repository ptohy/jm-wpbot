#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE is required}"
backup="${1:?usage: restore.sh BACKUP_FILE}"

test -r "$backup"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt "$backup" | gzip -dc | psql "$DATABASE_URL" --single-transaction --set ON_ERROR_STOP=1
echo "restore=ok"
