#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
for script in typecheck lint test build; do
  printf '\n> pnpm run %s\n' "$script"
  pnpm run "$script"
done
