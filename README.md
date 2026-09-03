# Browser Tools

Minimal Bash-friendly Chrome DevTools Protocol (CDP) tools for collaborative browser exploration. Inspired by Mario Zechner's “What if you don't need MCP at all?” article.

These scripts intentionally have **no npm dependencies**; they use Node 22+'s built-in `fetch` and `WebSocket`.

## Layout

```text
browser-tools/
├── start.js
├── status.js
├── nav.js
├── eval.js
├── screenshot.js
├── dom.js
├── click.js
├── type.js
├── wait.js
├── pick.js
├── cookies.js
└── lib/cdp.js
```

The short script names live under the `browser-tools/` directory to avoid root clutter and repeated prefixes. Each script imports `./lib/cdp.js`, so keep/copy the directory as a unit.

## Native Pi/Docker Sandbox packaging

Recommended setup for reusable sandbox work:

- **Pi-native instructions:** use the bundled Agent Skill at `skills/browser-tools/SKILL.md`. Pi discovers skills from `~/.pi/agent/skills`, `~/.agents/skills`, project `.pi/skills`, project `.agents/skills`, or a Pi package manifest.
- **Docker Sandbox-native mounting/injection:** use a **mixin kit**. Kits can inject scripts into the workspace, add network permissions, and add agent memory without baking everything into an agent image.

This repo includes a kit template and builder:

```bash
./scripts/build-docker-kit.sh                 # writes dist/pi-browser-tools-kit
sbx run pi . --kit ./dist/pi-browser-tools-kit
```

The generated kit injects scripts into the workspace under `./browser-tools/` and installs the Pi skill under `./.agents/skills/browser-tools/SKILL.md`.

The builder copies `browser-tools/lib/cdp.js` along with the scripts, so shared CDP helpers are present in the kit output.

## Docker Sandbox + Pi quick start

### Option A: sandbox-local headless browser

```bash
# Install Chrome/Chromium separately, or set BROWSER_TOOLS_CHROME=/path/to/chrome
./browser-tools/start.js --headless
./browser-tools/status.js
./browser-tools/nav.js https://example.com
./browser-tools/dom.js --limit 30
./browser-tools/screenshot.js --out .browser-tools/latest.png
```

In Docker Sandbox, `start.js` passes `HTTP_PROXY`/`HTTPS_PROXY` to Chrome by default so page loads use the sandbox network policy. Use `--no-proxy` only when you know direct browser networking is desired.

### Option B: visible host browser for interactive picking

Start Chrome on the host with remote debugging, then point the sandbox tools at it:

```bash
export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:9222
./browser-tools/status.js
./browser-tools/pick.js "Select the product cards"
```

If this fails, check what Chrome printed on startup. Recent Chrome builds often print a loopback-only CDP endpoint like:

```text
DevTools listening on ws://127.0.0.1:9222/devtools/browser/...
```

That endpoint is reachable from the host, but not necessarily from Docker Sandbox via `host.docker.internal`. Try starting Chrome with an explicit bind address:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --remote-allow-origins='*' \
  --user-data-dir=/tmp/browser-tools-profile
```

If Chrome still binds CDP to `127.0.0.1`, expose it through a host-side TCP forwarder and use the forwarded port from the sandbox:

```bash
# Host terminal
socat TCP-LISTEN:9223,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9222

# Sandbox/Pi terminal
export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:9223
./browser-tools/status.js
```

If `socat` is unavailable, a Node.js forwarder works too:

```bash
# Host terminal
node -e 'const net=require("node:net"); net.createServer(c=>{const s=net.connect(9222,"127.0.0.1"); c.pipe(s); s.pipe(c); s.on("error",()=>c.destroy()); c.on("error",()=>s.destroy());}).listen(9223,"0.0.0.0")'
```

Keep forwarded CDP ports local/trusted; CDP gives powerful control over the browser. If sandbox networking blocks the CDP endpoint or target sites, allow the needed host/ports/domains from the Docker Sandbox policy.

Common connection options for most tools:

```bash
--port 9222                            # local sandbox browser
--cdp http://host.docker.internal:9222 # host/remote browser
```

or set:

```bash
export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:9222
```

## Start Chrome/Chromium

```bash
./browser-tools/start.js              # Fresh tool profile on :9222
./browser-tools/start.js --profile    # Copy sandbox-local default Chrome/Chromium profile first
./browser-tools/start.js --headless   # Force headless mode
./browser-tools/start.js --headed     # Force headed mode
./browser-tools/start.js --kill       # Stop a browser previously started on this port
```

Starts Chrome/Chromium with remote debugging on `127.0.0.1:9222`. If no display is present on Linux, headless mode is selected automatically.

If the browser cannot be found, install Chromium/Chrome or set one of:

```bash
export BROWSER_TOOLS_CHROME=/path/to/chrome
export CHROME_PATH=/path/to/chrome
export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

## Status

```bash
./browser-tools/status.js
./browser-tools/status.js --json
```

Checks the CDP connection and lists tabs. The last page is the default active tab used by other tools.

## Navigate

```bash
./browser-tools/nav.js https://example.com
./browser-tools/nav.js https://example.com --new
```

Navigates the active tab or opens a new tab.

## Evaluate JavaScript

```bash
./browser-tools/eval.js 'document.title'
./browser-tools/eval.js 'document.querySelectorAll("a").length'
./browser-tools/eval.js 'await fetch(location.href).then(r => r.status)'
./browser-tools/eval.js 'const links = [...document.links]; return links.map(a => a.href)'
./browser-tools/eval.js --file ./inspect-page.js --json
```

Executes JavaScript in the active tab. Code is tried as an async expression first; if invalid syntax, it is run as an async function body. Objects and arrays are printed as JSON.

## Screenshot

```bash
./browser-tools/screenshot.js
./browser-tools/screenshot.js --full-page
./browser-tools/screenshot.js --out .browser-tools/latest.png
```

Captures the active tab viewport as a PNG and prints the file path. Default output is `.browser-tools/screenshots/<timestamp>.png` in the current directory, which Pi can read as an image.

## Headless interaction helpers

```bash
./browser-tools/dom.js --limit 50
./browser-tools/dom.js --selector 'button,a,input' --json
./browser-tools/wait.js --selector '#submit'
./browser-tools/click.js '#submit'
./browser-tools/type.js 'input[name=q]' 'search text' --clear
```

These are small convenience wrappers around CDP/page JavaScript so agents do not need brittle shell quoting for common headless tasks.

## Pick Elements

```bash
./browser-tools/pick.js "Click the submit button"
./browser-tools/pick.js --json "Select the product cards"
```

Interactive element picker in the active tab. Click to select one element. Cmd/Ctrl+Click adds multiple elements, Enter finishes, and Escape cancels. Best with a visible host browser.

## Cookies

```bash
./browser-tools/cookies.js
./browser-tools/cookies.js --all
```

Prints cookies as JSON. Default mode returns cookies for the active tab URL, including HTTP-only cookies available through CDP. `--all` returns all browser cookies.

## Tests

Fast structural/help tests:

```bash
npm test
```

Docker-backed Chrome integration test:

```bash
npm run test:docker
```

By default this uses `mcr.microsoft.com/playwright:v1.56.1-noble`. Override with:

```bash
BROWSER_TOOLS_TEST_IMAGE=your/chrome-image npm run test:docker
```

The Docker test starts headless Chrome in a container, exposes CDP through a local port, and verifies navigation, evaluation, DOM dump, type, click, wait, screenshot, and cookies.

## Local usage without a kit

From this repo, run scripts by path:

```bash
./browser-tools/status.js
```

or add the tools directory to `PATH` if you want short commands in this local checkout:

```bash
export PATH="$PATH:/home/vova/Projects/pi-kit-dev-tools/browser-tools"
status.js
```
