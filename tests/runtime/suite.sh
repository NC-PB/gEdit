#!/bin/sh
# Runs suite files and/or scenarios one after another and prints a PASS/FAIL table.
# Usage: tests/runtime/suite.sh <suite.txt | scenario>...
exec node "$(dirname "$0")/harness/suite.mjs" "$@"
