#!/usr/bin/env bash
set -euo pipefail

BACKUP_REPO="$HOME/nanoclaw-data-backup"
NANOCLAW_DATA="/home/nanoclaw/nanoclaw/data/v2.db"
STORE_DB="/home/nanoclaw/nanoclaw/store/messages.db"
SSH_KEY="/home/nanoclaw/.ssh/id_ed25519"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no"

# Clone repo if not present
if [ ! -d "$BACKUP_REPO/.git" ]; then
  git clone git@github.com:jb0ta/nanoclaw-data-backup.git "$BACKUP_REPO"
fi

cd "$BACKUP_REPO"

# Ensure .gitignore is correct
if ! grep -qx '.env' .gitignore 2>/dev/null; then
  echo '.env' >> .gitignore
fi
if ! grep -qx '*.env' .gitignore 2>/dev/null; then
  echo '*.env' >> .gitignore
fi

# Copy DBs
cp "$NANOCLAW_DATA" v2.db

if [ -f "$STORE_DB" ]; then
  cp "$STORE_DB" messages.db
fi

# Commit and push
git add v2.db messages.db .gitignore 2>/dev/null || git add v2.db .gitignore
git diff --cached --quiet && echo "No changes to commit" && exit 0

git commit -m "backup: $TIMESTAMP"
git push origin main
