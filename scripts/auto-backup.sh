#!/bin/bash
# Auto-backup: stage, commit (only if changes exist), and push to backup remote.
# Designed to be run from cron — exits 0 silently when there is nothing to commit.

REPO=/home/nanoclaw/nanoclaw
LOG="$REPO/logs/auto-backup.log"

cd "$REPO"

git add -A

# Exit silently if the index is clean (nothing to commit)
if git diff --cached --quiet; then
  exit 0
fi

MSG="auto-backup: $(date +%Y-%m-%d_%H:%M)"
git commit -m "$MSG" >> "$LOG" 2>&1 || exit 1
git push backup main >> "$LOG" 2>&1 || exit 1

echo "$(date -Iseconds) pushed: $MSG" >> "$LOG"
