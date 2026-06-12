#!/bin/bash
set -e

# Render build: actually rebuild api-server from source so dist/ stays in sync.
# Prevents stale-dist deploys when src changes aren't accompanied by a dist rebuild.

echo "==> Node: $(node --version) | npm: $(npm --version)"

# Fix for EROFS: use NPM_CONFIG_PREFIX to install pnpm to home dir (not /usr/lib)
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> pnpm not found — installing to home dir (avoids EROFS on /usr/lib)"
  export NPM_CONFIG_PREFIX="$HOME/.npm-global"
  npm install -g pnpm@10
  export PATH="$HOME/.npm-global/bin:$PATH"
  echo "==> pnpm installed: $(pnpm --version)"
else
  echo "==> pnpm version: $(pnpm --version)"
fi

echo "==> Installing api-server workspace deps (filtered, no lockfile freeze to tolerate minor drift)"
pnpm install --filter @workspace/api-server... --no-frozen-lockfile

echo "==> Building api-server"
pnpm --filter @workspace/api-server run build

echo "==> Installing @gradio/client (runtime, not bundled)"
npm install @gradio/client

echo "==> Render build complete"

echo "==> Build complete at 2026-06-12 07:00 UTC"
