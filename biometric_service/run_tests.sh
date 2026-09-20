#!/usr/bin/env bash
# Whole Python suite, stdlib runner only - no pytest, no model weights.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 -m unittest discover -p "test_*.py" -v
