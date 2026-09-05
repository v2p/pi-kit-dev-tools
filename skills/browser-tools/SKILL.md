---
name: browser-tools
description: Bash/Chrome DevTools Protocol tools for browser navigation, JS eval, screenshots, DOM inspection, click/type/wait, interactive picking, and cookies. Use for browser automation without MCP.
compatibility: Requires Node 22+ and a CDP endpoint. Sandbox-local Chrome/Chromium via start.js, or host Chrome via BROWSER_TOOLS_CDP_URL.
---

# Browser Tools

Run tools from the workspace root as `./browser-tools/<tool>.js` or use absolute paths. Prefer file outputs for screenshots/large JSON.

## Connect

Check CDP first:

```bash
./browser-tools/status.js
```

If no browser is connected:

```bash
# Sandbox-local/headless, after Chrome/Chromium is installed:
./browser-tools/start.js --headless

# Visible host Chrome for Docker Sandbox; ask user to run on host:
make -f docker-kit/host.Makefile chrome-debug
make -f docker-kit/host.Makefile cdp-relay   # preferred relay for Host-header/loopback issues

# Then in sandbox:
export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:9223
```

Use relay port `9223` when Chrome rejects `host.docker.internal` with `Host header is specified and is not an IP address or localhost`, or when Chrome binds CDP to `127.0.0.1`. If sandbox policy blocks it, ask the user to run on host:

```bash
sbx policy allow network localhost:9223
```

Most commands also accept `--cdp http://host:9222` or `--port 9222`. If the relay is unavailable, ask the user to forward host `0.0.0.0:9223` to `127.0.0.1:9222`.

## Core Commands

```bash
./browser-tools/nav.js https://example.com       # navigate active tab
./browser-tools/nav.js https://example.com --new # open new tab
./browser-tools/eval.js 'document.title'
./browser-tools/eval.js --file ./script.js --json
./browser-tools/screenshot.js --out .browser-tools/latest.png
./browser-tools/cookies.js                       # active-tab cookies incl. HTTP-only via CDP
```

## Headless Interaction

Use these when no visible browser/manual input is available:

```bash
./browser-tools/dom.js --selector 'button,a,input' --json
./browser-tools/wait.js --selector '#submit'
./browser-tools/click.js '#submit'
./browser-tools/type.js 'input[name=q]' 'search text' --clear
```

## Interactive Element Picking

Use `pick.js` only with a visible browser. Tell the user it will wait for their manual selection, use a specific prompt, and prefer `--json`:

```bash
./browser-tools/pick.js --json "Select the checkout button"
```

Controls: move highlights; click selects one and finishes; Cmd/Ctrl+Click adds multiple; Enter finishes multi-select; Escape returns `null`. Use returned `selector`, `text`, `href`, `rect`, or `html` for the next action. If the choice is ambiguous, ask the user to pick again.

## Output Guidance

- Save screenshots inside the workspace so Pi can read them.
- Redirect/filter large JSON with files, code, or `jq`.
- If a site/host is blocked, ask the user to allow it in Docker Sandbox network policy.
