#!/bin/bash
set -e

echo ">>> Node: $(node --version)"
echo ">>> npm: $(npm --version)"
echo ">>> HOME: $HOME"
echo ">>> PWD: $(pwd)"

PNPM_DIR="$HOME/.npm-global"
PNPM_BIN="$PNPM_DIR/bin/pnpm"

echo ">>> Installing pnpm@10.26.1 to $PNPM_DIR ..."
npm install -g pnpm@10.26.1 --prefix "$PNPM_DIR"
echo ">>> pnpm installed: $($PNPM_BIN --version)"

echo ">>> Removing stale pnpm-lock.yaml to force clean dependency resolution..."
rm -f pnpm-lock.yaml

echo ">>> Installing workspace dependencies..."
$PNPM_BIN install --no-frozen-lockfile

echo ">>> Building API server..."
$PNPM_BIN --filter @workspace/api-server run build

echo ">>> Build complete!"
ls -la artifacts/api-server/dist/ 2>/dev/null || echo "WARNING: dist folder not found"
