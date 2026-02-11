#!/bin/bash
# Sync contracts from panoptic-next-core-private-post-vuln (fix/c4-fixes branch)
# Run this script when you need to pull the latest contract changes

set -e

CONTRACTS_REPO="../../../panoptic-next-core-private-post-vuln"
BRANCH="fix/c4-fixes"
TARGET_DIR="./contracts"

# Check if contracts repo exists
if [ ! -d "$CONTRACTS_REPO" ]; then
  echo "Error: Contracts repo not found at $CONTRACTS_REPO"
  exit 1
fi

# Check if we're on the right branch
cd "$CONTRACTS_REPO"
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "Warning: Contracts repo is on branch '$CURRENT_BRANCH', expected '$BRANCH'"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Get current commit hash
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_SHORT=$(git rev-parse --short HEAD)

cd - > /dev/null

# Create target directory
mkdir -p "$TARGET_DIR"

# Copy Solidity contracts
echo "Copying contracts..."
rsync -av --delete \
  --include='*/' \
  --include='*.sol' \
  --exclude='*' \
  "$CONTRACTS_REPO/contracts/" "$TARGET_DIR/"

# Copy foundry.toml if needed
if [ -f "$CONTRACTS_REPO/foundry.toml" ]; then
  cp "$CONTRACTS_REPO/foundry.toml" "$TARGET_DIR/"
fi

# Write sync metadata
cat > "$TARGET_DIR/sync-metadata.json" <<EOF
{
  "syncedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "branch": "$BRANCH",
  "commit": "$COMMIT_HASH",
  "commitShort": "$COMMIT_SHORT",
  "sourceRepo": "panoptic-next-core-private-post-vuln"
}
EOF

echo "✓ Contracts synced successfully from commit $COMMIT_SHORT"
echo "✓ Metadata written to $TARGET_DIR/sync-metadata.json"
