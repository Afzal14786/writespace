#!/usr/bin/env sh

set -eu

# Resolve the project root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ]; then
  echo "[seed] Dependencies not installed. Run npm install first."
  exit 1
fi

echo "[seed] Starting Writespace database seeding..."

exec npx ts-node -r tsconfig-paths/register src/scripts/seed/index.ts