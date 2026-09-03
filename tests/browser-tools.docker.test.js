import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import net from "node:net";
import { CDPClient, getActivePage, sleep } from "../browser-tools/lib/cdp.js";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const toolsDir = join(root, "browser-tools");
const shouldRun = process.env.RUN_BROWSER_TOOLS_DOCKER_TESTS === "1";
const image = process.env.BROWSER_TOOLS_TEST_IMAGE ?? "mcr.microsoft.com/playwright:v1.56.1-noble";

const chromeCommand = String.raw`
set -eu
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || find /ms-playwright -path '*/chrome-linux/chrome' -type f | head -n 1)"
if [ -z "$chrome" ]; then
  echo "No Chrome/Chromium executable found in image" >&2
  exit 1
fi
# Recent Chrome builds bind CDP to loopback even when remote-debugging-address is set.
# Expose it through a tiny TCP forwarder so Docker port publishing can reach it.
node -e 'const net=require("node:net"); net.createServer(c=>{const s=net.connect(9222,"127.0.0.1"); c.pipe(s); s.pipe(c); s.on("error",()=>c.destroy()); c.on("error",()=>s.destroy());}).listen(9223,"0.0.0.0")' &
exec "$chrome" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --user-data-dir=/tmp/browser-tools-profile \
  about:blank
`;

test("browser tools drive Chrome from a Docker image over CDP", { skip: !shouldRun, timeout: 300_000 }, async () => {
	const port = await freePort();
	const cdpUrl = `http://127.0.0.1:${port}`;
	const name = `browser-tools-test-${process.pid}-${Date.now()}`;
	const outDir = await mkdtemp(join(tmpdir(), "browser-tools-test-"));

	await docker([
		"run",
		"--rm",
		"-d",
		"--name", name,
		"--shm-size=1g",
		"-p", `127.0.0.1:${port}:9223`,
		"--add-host", "host.docker.internal:host-gateway",
		image,
		"bash",
		"-lc",
		chromeCommand,
	]);

	try {
		await waitForCdp(cdpUrl, 60_000);

		const status = await tool("status", ["--cdp", cdpUrl]);
		assert.match(status.stdout, /browser:/);
		assert.match(status.stdout, /pages:/);

		const html = `<!doctype html>
<html>
<head><title>Browser Tools Test</title></head>
<body>
  <h1>Hello Browser Tools</h1>
  <input name="q" value="">
  <button id="submit" onclick="document.querySelector('#out').textContent = 'Clicked ' + document.querySelector('[name=q]').value">Submit</button>
  <p id="out">Waiting</p>
</body>
</html>`;
		await tool("nav", [`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, "--cdp", cdpUrl]);

		const title = await tool("eval", ["document.title", "--cdp", cdpUrl]);
		assert.equal(title.stdout.trim(), "Browser Tools Test");

		const dom = await tool("dom", ["--selector", "input,button,#out", "--json", "--cdp", cdpUrl]);
		const elements = JSON.parse(dom.stdout);
		assert.deepEqual(elements.map((element) => element.tag), ["input", "button", "p"]);

		await tool("type", ["input[name=q]", "hello", "--clear", "--cdp", cdpUrl]);
		const value = await tool("eval", ['document.querySelector("input[name=q]").value', "--cdp", cdpUrl]);
		assert.equal(value.stdout.trim(), "hello");

		await tool("click", ["#submit", "--cdp", cdpUrl]);
		const waited = await tool("wait", ["--text", "Clicked hello", "--cdp", cdpUrl]);
		assert.match(waited.stdout, /Clicked hello/);

		const screenshotPath = join(outDir, "page.png");
		const screenshot = await tool("screenshot", ["--out", screenshotPath, "--cdp", cdpUrl]);
		assert.equal(screenshot.stdout.trim(), screenshotPath);
		const png = await readFile(screenshotPath);
		assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

		await setCookieThroughCdp(cdpUrl);
		const cookies = await tool("cookies", ["--all", "--cdp", cdpUrl]);
		const parsedCookies = JSON.parse(cookies.stdout);
		assert.ok(parsedCookies.some((cookie) => cookie.name === "browserToolsHttpOnly" && cookie.httpOnly === true));
	} finally {
		await docker(["rm", "-f", name]).catch(() => {});
		await rm(outDir, { recursive: true, force: true });
	}
});

async function tool(name, args) {
	return execFileAsync(join(toolsDir, `${name}.js`), args, { cwd: root, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
}

async function docker(args) {
	return execFileAsync("docker", args, { timeout: 300_000, maxBuffer: 20 * 1024 * 1024 });
}

async function waitForCdp(cdpUrl, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${cdpUrl}/json/version`);
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
		} catch (error) {
			lastError = error;
		}
		await sleep(500);
	}
	throw new Error(`Timed out waiting for CDP at ${cdpUrl}: ${lastError?.message ?? "unknown error"}`);
}

async function setCookieThroughCdp(cdpUrl) {
	const page = await getActivePage(cdpUrl);
	const client = await new CDPClient(page.webSocketDebuggerUrl).connect();
	try {
		await client.send("Network.enable");
		const result = await client.send("Network.setCookie", {
			name: "browserToolsHttpOnly",
			value: "secret",
			url: "https://example.test/",
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
		});
		assert.equal(result.success, true);
	} finally {
		client.close();
	}
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => resolve(address.port));
		});
	});
}
