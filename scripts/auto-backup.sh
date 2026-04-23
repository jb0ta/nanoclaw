#!/bin/bash
# Auto-backup: stage everything (including session skills and group configs),
# commit only if there are changes, then push to both private and backup remotes.
# Exits 0 silently when nothing to commit.

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

# Push to both remotes; log failures but don't abort the other push
git push private main >> "$LOG" 2>&1 || echo "$(date -Iseconds) WARN: push to private failed" >> "$LOG"
git push backup main  >> "$LOG" 2>&1 || echo "$(date -Iseconds) WARN: push to backup failed"  >> "$LOG"

echo "$(date -Iseconds) pushed: $MSG" >> "$LOG"
