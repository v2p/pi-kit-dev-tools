#!/usr/bin/env node

import net from "node:net";

const listenPort = numberEnv("CDP_RELAY_PORT", 9223);
const listenHost = process.env.CDP_RELAY_ADDRESS || "0.0.0.0";
const chromePort = numberEnv("CHROME_DEBUG_PORT", 9222);
const chromeHost = process.env.CHROME_DEBUG_HOST || "127.0.0.1";

const server = net.createServer((client) => {
	const upstream = net.connect(chromePort, chromeHost);
	let pending = Buffer.alloc(0);
	let passthrough = false;

	client.on("data", (chunk) => {
		if (passthrough) {
			upstream.write(chunk);
			return;
		}

		pending = Buffer.concat([pending, chunk]);
		flushHttpHeaders();
	});

	function flushHttpHeaders() {
		while (pending.length > 0) {
			const marker = pending.indexOf("\r\n\r\n");
			if (marker === -1) return;

			const rawHead = pending.subarray(0, marker + 4).toString("latin1");
			const head = rawHead.replace(/^Host:.*$/mi, `Host: localhost:${chromePort}`);
			upstream.write(Buffer.from(head, "latin1"));
			pending = pending.subarray(marker + 4);

			if (/^Upgrade:\s*websocket\s*$/mi.test(rawHead)) {
				passthrough = true;
				if (pending.length > 0) upstream.write(pending);
				pending = Buffer.alloc(0);
				return;
			}
		}
	}

	upstream.pipe(client);
	upstream.on("error", () => client.destroy());
	client.on("error", () => upstream.destroy());
});

server.listen(listenPort, listenHost, () => {
	console.error(`CDP relay listening on ${listenHost}:${listenPort} -> ${chromeHost}:${chromePort}`);
	console.error(`In the sandbox, use: export BROWSER_TOOLS_CDP_URL=http://host.docker.internal:${listenPort}`);
});

function numberEnv(name, fallback) {
	const value = Number(process.env[name] || fallback);
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
	return value;
}
