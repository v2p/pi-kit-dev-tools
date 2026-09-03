#!/usr/bin/env node

import { CDPClient, createPage, fail, getActivePage, parseCdpUrl, stripCdpOptions, stripOption, waitForEvent } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const newTab = args.includes("--new");
const help = args.includes("--help") || args.includes("-h");
const rest = stripOption(stripOption(stripOption(stripCdpOptions(args), "--new"), "--help"), "-h");
const url = rest[0];

if (help || !url || rest.length > 1) {
	console.log(`Usage: nav.js <url> [--new] [--port 9222 | --cdp http://host:9222]\n\nNavigate the current tab, or open a new tab with --new.`);
	process.exit(help ? 0 : 1);
}

try {
	const target = newTab ? await createPage(browserUrl) : await getActivePage(browserUrl);
	const client = await new CDPClient(target.webSocketDebuggerUrl).connect();
	try {
		await client.send("Page.enable");
		await client.send("Page.bringToFront").catch(() => {});
		const loaded = waitForEvent(client, "Page.domContentEventFired", 30_000).catch(() => null);
		await client.send("Page.navigate", { url });
		await loaded;
	} finally {
		client.close();
	}
	console.log(`✓ ${newTab ? "Opened" : "Navigated to"}: ${url}`);
} catch (error) {
	fail(error);
}
