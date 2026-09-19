#!/bin/sh
# Runs one scenario against the synced test app; exits 0 when it passes.
# Usage: tests/runtime/run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]... [--timeout S]
exec node "$(dirname "$0")/harness/run.mjs" "$@"
