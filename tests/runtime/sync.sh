#!/bin/sh
# Copies the repo to $GEDIT_RH_DIR/app, patches the harness in and builds the test app.
# Usage: tests/runtime/sync.sh [--repo DIR]   (see tests/runtime/README.md)
exec node "$(dirname "$0")/harness/sync.mjs" "$@"
