#!/bin/sh
cd "$(dirname "$0")"
if [ ! -x .venv/bin/uvicorn ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/uvicorn server:app --host 0.0.0.0 --port "${PORT:-8000}"
