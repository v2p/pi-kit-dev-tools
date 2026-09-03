const DEFAULT_PORT = 9222;
const DEFAULT_HOST = "127.0.0.1";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function parsePort(argv) {
	const index = argv.indexOf("--port");
	if (index === -1) return DEFAULT_PORT;
	const value = argv[index + 1];
	if (!value || Number.isNaN(Number(value))) {
		throw new Error("--port requires a numeric value");
	}
	return Number(value);
}

export function parseCdpUrl(argv) {
	const explicitCdp = optionValue(argv, "--cdp") ?? optionValue(argv, "--browser-url");
	if (explicitCdp) return normalizeBrowserUrl(explicitCdp);
	if (argv.includes("--port")) return defaultBrowserUrl(parsePort(argv));
	return normalizeBrowserUrl(process.env.BROWSER_TOOLS_CDP_URL ?? defaultBrowserUrl(DEFAULT_PORT));
}

export function stripCdpOptions(argv) {
	return stripOption(stripOption(stripOption(argv, "--port", true), "--cdp", true), "--browser-url", true);
}

export function stripOption(argv, name, takesValue = false) {
	const index = argv.indexOf(name);
	if (index === -1) return argv;
	const removeCount = takesValue ? 2 : 1;
	return [...argv.slice(0, index), ...argv.slice(index + removeCount)];
}

export function connectionLabel(browserUrl) {
	return normalizeBrowserUrl(browserUrl).replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function httpJson(path, { browserUrl = defaultBrowserUrl(), port, method = "GET" } = {}) {
	const base = port ? defaultBrowserUrl(port) : normalizeBrowserUrl(browserUrl);
	let response;
	try {
		response = await fetch(new URL(path, base).toString(), { method });
	} catch (error) {
		throw new Error(`Could not connect to CDP at ${connectionLabel(base)}: ${error.message}`);
	}
	if (!response.ok) {
		throw new Error(`${method} ${path} failed on ${connectionLabel(base)}: HTTP ${response.status} ${await response.text()}`);
	}
	return response.json();
}

export async function isDebuggingReady(browserUrl = defaultBrowserUrl()) {
	try {
		await httpJson("/json/version", { browserUrl });
		return true;
	} catch {
		return false;
	}
}

export async function waitForDebugging(browserUrl = defaultBrowserUrl(), timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isDebuggingReady(browserUrl)) return;
		await sleep(250);
	}
	throw new Error(`Chrome/Chromium did not become ready on ${connectionLabel(browserUrl)}`);
}

export async function getVersion(browserUrl = defaultBrowserUrl()) {
	return httpJson("/json/version", { browserUrl });
}

export async function getTargets(browserUrl = defaultBrowserUrl()) {
	const base = normalizeBrowserUrl(browserUrl);
	const targets = await httpJson("/json/list", { browserUrl: base });
	return targets.map((target) => rewriteTargetWebSocketUrl(target, base));
}

export async function getActivePage(browserUrl = defaultBrowserUrl()) {
	const targets = await getTargets(browserUrl);
	const pages = targets.filter((target) => target.type === "page" && !target.url?.startsWith("devtools://"));
	const page = pages.at(-1);
	if (!page?.webSocketDebuggerUrl) {
		throw new Error(`No page target found on ${connectionLabel(browserUrl)}. Start the browser and open/navigate a page first.`);
	}
	return page;
}

export async function createPage(browserUrl = defaultBrowserUrl()) {
	const base = normalizeBrowserUrl(browserUrl);
	try {
		const target = await httpJson(`/json/new?${encodeURIComponent("about:blank")}`, { browserUrl: base, method: "PUT" });
		return rewriteTargetWebSocketUrl(target, base);
	} catch {
		const target = await httpJson(`/json/new?${encodeURIComponent("about:blank")}`, { browserUrl: base, method: "GET" });
		return rewriteTargetWebSocketUrl(target, base);
	}
}

export async function activateTarget(id, browserUrl = defaultBrowserUrl()) {
	return httpJson(`/json/activate/${encodeURIComponent(id)}`, { browserUrl });
}

export async function closeTarget(id, browserUrl = defaultBrowserUrl()) {
	const response = await fetch(new URL(`/json/close/${encodeURIComponent(id)}`, normalizeBrowserUrl(browserUrl)).toString());
	if (!response.ok) throw new Error(`Failed to close target ${id}: HTTP ${response.status} ${await response.text()}`);
	return response.text();
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForEvent(client, method, timeoutMs = 30_000) {
	return new Promise((resolve, reject) => {
		let timeout;
		const cleanup = client.on(method, (params) => {
			clearTimeout(timeout);
			cleanup();
			resolve(params);
		});
		timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for ${method}`));
		}, timeoutMs);
	});
}

export class CDPClient {
	constructor(webSocketDebuggerUrl) {
		this.webSocketDebuggerUrl = webSocketDebuggerUrl;
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = new Map();
	}

	async connect() {
		this.ws = new WebSocket(this.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			this.ws.addEventListener("open", resolve, { once: true });
			this.ws.addEventListener("error", () => reject(new Error(`WebSocket connection failed: ${this.webSocketDebuggerUrl}`)), { once: true });
		});

		this.ws.addEventListener("message", (event) => this.#handleMessage(event.data));
		this.ws.addEventListener("close", () => {
			for (const { reject } of this.pending.values()) reject(new Error("WebSocket closed"));
			this.pending.clear();
		});
		return this;
	}

	send(method, params = {}) {
		const id = this.nextId++;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
	}

	on(method, handler) {
		if (!this.listeners.has(method)) this.listeners.set(method, new Set());
		this.listeners.get(method).add(handler);
		return () => this.listeners.get(method)?.delete(handler);
	}

	close() {
		this.ws?.close();
	}

	#handleMessage(data) {
		const message = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
		if (message.id) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error) {
				pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ""}`));
			} else {
				pending.resolve(message.result);
			}
			return;
		}

		for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
	}
}

export async function withActivePage(browserUrl, fn) {
	const page = await getActivePage(browserUrl);
	const client = await new CDPClient(page.webSocketDebuggerUrl).connect();
	try {
		return await fn(client, page);
	} finally {
		client.close();
	}
}

export function printValue(value) {
	if (value === undefined) return;
	if (typeof value === "string") {
		console.log(value);
		return;
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		console.log(String(value));
		return;
	}
	console.log(JSON.stringify(value, null, 2));
}

export function fail(error) {
	console.error(`✗ ${error?.message ?? error}`);
	process.exit(1);
}

function defaultBrowserUrl(port = DEFAULT_PORT) {
	return `http://${DEFAULT_HOST}:${port}`;
}

function normalizeBrowserUrl(value) {
	if (typeof value === "number") return defaultBrowserUrl(value);
	const stringValue = String(value);
	const withProtocol = /^https?:\/\//i.test(stringValue) ? stringValue : `http://${stringValue}`;
	const url = new URL(withProtocol);
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url.toString();
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function rewriteTargetWebSocketUrl(target, browserUrl) {
	if (!target.webSocketDebuggerUrl) return target;
	return { ...target, webSocketDebuggerUrl: rewriteWebSocketUrl(target.webSocketDebuggerUrl, browserUrl) };
}

function rewriteWebSocketUrl(webSocketDebuggerUrl, browserUrl) {
	const ws = new URL(webSocketDebuggerUrl);
	const browser = new URL(browserUrl);
	const shouldRewrite = LOCAL_HOSTNAMES.has(ws.hostname) || LOCAL_HOSTNAMES.has(`[${ws.hostname}]`);
	if (shouldRewrite || ws.port === browser.port) {
		ws.protocol = browser.protocol === "https:" ? "wss:" : "ws:";
		ws.hostname = browser.hostname;
		ws.port = browser.port;
	}
	return ws.toString();
}
