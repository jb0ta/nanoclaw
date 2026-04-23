#!/bin/bash
# Backs up data/v2.db to ~/nanoclaw-data-backup, commits with timestamp,
# and pushes to origin main. Exits 0 silently when db hasn't changed.

REPO=/home/nanoclaw/nanoclaw
BACKUP=/home/nanoclaw/nanoclaw-data-backup
LOG="$REPO/logs/backup-v2db.log"
RCLONE_CONF=/home/nanoclaw/.rclone.conf
RCLONE_DEST="gdrive:nanoclaw-db-backup"

# Copy with a brief wal checkpoint to get a consistent snapshot
sqlite3 "$REPO/data/v2.db" "PRAGMA wal_checkpoint(PASSIVE);" 2>/dev/null || true
cp "$REPO/data/v2.db" "$BACKUP/v2.db"

cd "$BACKUP"

git add v2.db

if git diff --cached --quiet; then
  exit 0
fi

MSG="backup: v2.db $(date +%Y-%m-%d_%H:%M)"
git commit -m "$MSG" >> "$LOG" 2>&1 || exit 1
git push origin main >> "$LOG" 2>&1 || echo "$(date -Iseconds) WARN: push failed" >> "$LOG"

echo "$(date -Iseconds) pushed: $MSG" >> "$LOG"

# Sync to Google Drive
rclone copy "$REPO/data/v2.db" "$RCLONE_DEST/" \
  --config "$RCLONE_CONF" \
  --log-level ERROR \
  --log-file "$LOG"
