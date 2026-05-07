#!/bin/bash
# City Pin Map launcher — double-click in Finder to start the app.
# Closing this Terminal window stops the server.

cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 isn't installed. Install it from python.org and try again."
  read -n 1 -s -r -p "Press any key to close this window..."
  echo
  exit 1
fi

is_port_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

PORT=""
for candidate in 8000 8001 8002 8003 8004 8005 8006 8007 8008 8009 8010; do
  if is_port_free "$candidate"; then PORT="$candidate"; break; fi
done

if [ -z "$PORT" ]; then
  echo "Ports 8000–8010 are all in use. Close other servers and try again."
  read -n 1 -s -r -p "Press any key to close this window..."
  echo
  exit 1
fi

open "http://localhost:$PORT"
exec python3 -m http.server "$PORT"
