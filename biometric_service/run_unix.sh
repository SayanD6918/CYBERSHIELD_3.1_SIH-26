#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt

# Bind to loopback by default. The service takes unauthenticated image
# uploads, so exposing it on 0.0.0.0 puts it on every interface on the
# network; set BIOMETRIC_HOST deliberately if that is what you want.
exec .venv/bin/python -m uvicorn main:app \
  --host "${BIOMETRIC_HOST:-127.0.0.1}" \
  --port "${BIOMETRIC_PORT:-8765}"
