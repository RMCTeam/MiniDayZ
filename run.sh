#!/usr/bin/env bash
#
# run.sh - Launch the MiniDayZ browser game locally.
#
# MiniDayZ is a static Construct 2 web app. It must be served over HTTP
# (not opened via file://) because it loads data/images with AJAX and
# registers a service worker. This script starts a tiny local web server
# for the build you choose and opens it in your browser.
#
# Usage:
#   ./run.sh                 # Plus 1.2 (default)
#   ./run.sh plus            # Plus 1.2
#   ./run.sh original        # Original 1.4.1
#   ./run.sh reloaded        # Reloaded 1.1
#   ./run.sh -p 9000         # use a specific port
#   ./run.sh --app           # try to open a fullscreen chrome app window
#   ./run.sh --no-browser    # just start the server, don't open a browser
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VARIANT="plus"
PORT="${PORT:-8000}"
OPEN_BROWSER=1
APP_MODE=0

usage() {
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        plus|docs)      VARIANT="plus";     shift ;;
        original|orig)  VARIANT="original"; shift ;;
        reloaded|rel)   VARIANT="reloaded"; shift ;;
        -p|--port)      PORT="$2";          shift 2 ;;
        --app)          APP_MODE=1;         shift ;;
        --no-browser)   OPEN_BROWSER=0;     shift ;;
        -h|--help)      usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; echo; usage; exit 1 ;;
    esac
done

case "$VARIANT" in
    plus)     DIR="$SCRIPT_DIR/docs";          TITLE="MiniDayZ Plus 1.2" ;;
    original) DIR="$SCRIPT_DIR/original_docs"; TITLE="MiniDayZ Original 1.4.1" ;;
    reloaded) DIR="$SCRIPT_DIR/reloaded_docs"; TITLE="MiniDayZ Reloaded 1.1" ;;
esac

if [[ ! -f "$DIR/index.html" ]]; then
    echo "Error: '$DIR/index.html' not found." >&2
    echo "Did you clone the repository first?" >&2
    exit 1
fi

# Pick a Python interpreter for the built-in static file server.
if command -v python3 >/dev/null 2>&1; then
    PY=python3
elif command -v python >/dev/null 2>&1; then
    PY=python
else
    echo "Error: Python 3 is required but was not found on PATH." >&2
    exit 1
fi

# Find a free TCP port starting from the requested one.
PORT="$("$PY" - "$PORT" <<'PYEOF'
import socket, sys
start = int(sys.argv[1])
for port in range(start, start + 100):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        s.close()
        print(port)
        break
    except OSError:
        s.close()
else:
    sys.exit("No free port found.")
PYEOF
)"

URL="http://localhost:$PORT/"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo "Starting $TITLE"
echo "  Directory : $DIR"
echo "  URL       : $URL"
echo "  Stop with : Ctrl+C"
echo

cd "$DIR"
"$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

# Wait until the server is actually accepting connections.
for _ in $(seq 1 50); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
        exec 3>&- 2>/dev/null || true
        break
    fi
    sleep 0.1
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Error: the web server failed to start." >&2
    exit 1
fi

open_browser() {
    if [[ "$APP_MODE" == "1" ]]; then
        for browser in google-chrome google-chrome-stable chromium chromium-browser; do
            if command -v "$browser" >/dev/null 2>&1; then
                "$browser" --app="$URL" --start-fullscreen --window-size=1280,800 >/dev/null 2>&1 &
                return
            fi
        done
        echo "Note: no Chrome/Chromium found for --app mode, using default browser."
    fi

    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then      # macOS
        open "$URL" >/dev/null 2>&1 &
    elif command -v sensible-browser >/dev/null 2>&1; then
        sensible-browser "$URL" >/dev/null 2>&1 &
    elif [[ -n "${BROWSER:-}" ]]; then
        "$BROWSER" "$URL" >/dev/null 2>&1 &
    else
        echo "Open this URL in your browser: $URL"
    fi
}

if [[ "$OPEN_BROWSER" == "1" ]]; then
    open_browser
    echo "Tip: press F11 (or use --app) for fullscreen before the game loads."
fi

wait "$SERVER_PID"
