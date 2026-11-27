#!/usr/bin/env sh
# Thin wrapper so POSIX shells can run the verification runner directly.
exec node "$(dirname "$0")/check.mjs" "$@"
