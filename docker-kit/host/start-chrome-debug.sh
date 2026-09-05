#!/usr/bin/env bash
set -euo pipefail

chrome_bin="${CHROME_BIN:-}"
chrome_debug_port="${CHROME_DEBUG_PORT:-9222}"
chrome_debug_address="${CHROME_DEBUG_ADDRESS:-0.0.0.0}"
chrome_user_data_dir="${CHROME_USER_DATA_DIR:-/tmp/pi-browser-tools-chrome-profile}"
chrome_url="${CHROME_URL:-about:blank}"

if [[ -z "$chrome_bin" ]]; then
	for candidate in google-chrome google-chrome-stable chromium chromium-browser chrome; do
		if command -v "$candidate" >/dev/null 2>&1; then
			chrome_bin="$(command -v "$candidate")"
			break
		fi
	done
fi

if [[ -z "$chrome_bin" && "$(uname -s)" == "Darwin" ]]; then
	for candidate in \
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
		'/Applications/Chromium.app/Contents/MacOS/Chromium' \
		'/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'; do
		if [[ -x "$candidate" ]]; then
			chrome_bin="$candidate"
			break
		fi
	done
fi

if [[ -z "$chrome_bin" ]]; then
	echo 'Could not find Chrome/Chromium. Set CHROME_BIN=/path/to/chrome.' >&2
	exit 127
fi

mkdir -p "$chrome_user_data_dir"

extra_flags=()
if [[ -n "${CHROME_EXTRA_FLAGS:-}" ]]; then
	# Intentionally split like a shell command line for simple flag overrides.
	# shellcheck disable=SC2206
	extra_flags=(${CHROME_EXTRA_FLAGS})
fi

echo "Starting $chrome_bin with CDP on ${chrome_debug_address}:${chrome_debug_port}"
echo 'In the sandbox, use:'
echo "  export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:${chrome_debug_port}"

exec "$chrome_bin" \
	--remote-debugging-port="$chrome_debug_port" \
	--remote-debugging-address="$chrome_debug_address" \
	--remote-allow-origins='*' \
	--user-data-dir="$chrome_user_data_dir" \
	"${extra_flags[@]}" \
	"$chrome_url"
