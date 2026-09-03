---
name: browser-tools
description: Minimal Bash/Chrome DevTools Protocol utilities for browser exploration, screenshots, page JavaScript, DOM inspection, headless click/type/wait, interactive element picking, and cookies. Use when a task needs browser automation without MCP.
compatibility: Requires Node 22+. Requires a CDP browser endpoint, either sandbox-local Chrome/Chromium started with browser-tools/start.js or a host browser exposed via BROWSER_TOOLS_CDP_URL.
---

# Browser Tools

Use the small CLI scripts in the workspace `browser-tools/` directory for Chrome DevTools Protocol browser work. They are intended to be composed through Bash and files rather than large tool-call outputs.

From the workspace root, run tools as `./browser-tools/<tool>.js`. If you are in another directory, first `cd` to the workspace root or use the absolute path.

## Setup Check

```bash
./browser-tools/status.js
```

If no browser is connected:

- For sandbox-local/headless browsing, use `./browser-tools/start.js --headless` after Chrome/Chromium is installed.
- For visible interactive picking in Docker Sandbox, ask the user to start a host browser with remote debugging and set:

```bash
export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:9222
```

Most commands accept `--cdp http://host:9222` or `--port 9222`.

## Core Commands

```bash
./browser-tools/nav.js https://example.com       # navigate active tab
./browser-tools/nav.js https://example.com --new # open new tab
./browser-tools/eval.js 'document.title'         # evaluate page JS
./browser-tools/eval.js --file ./script.js --json
./browser-tools/screenshot.js --out .browser-tools/latest.png
./browser-tools/cookies.js                       # cookies for active tab, including HTTP-only via CDP
```

## Headless Interaction

Prefer these in Docker Sandbox when no visible browser is available:

```bash
./browser-tools/dom.js --limit 50
./browser-tools/dom.js --selector 'button,a,input' --json
./browser-tools/wait.js --selector '#submit'
./browser-tools/click.js '#submit'
./browser-tools/type.js 'input[name=q]' 'search text' --clear
```

## Interactive Element Picking

Only use this with a visible browser, usually a host Chrome connected through `BROWSER_TOOLS_CDP_URL`:

```bash
./browser-tools/pick.js "Select the product cards" --json
```

## Output Guidance

- Save screenshots inside the workspace so Pi can read them as images.
- Redirect large JSON outputs to files and inspect/filter with code or `jq`.
- If a target site is blocked, ask the user to allow it in Docker Sandbox network policy.
