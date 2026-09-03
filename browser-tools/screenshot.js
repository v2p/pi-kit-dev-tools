#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail, parseCdpUrl, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const fullPage = args.includes("--full-page");
const help = args.includes("--help") || args.includes("-h");
const outIndex = args.indexOf("--out");
const outPath = outIndex === -1 ? defaultPath() : resolve(args[outIndex + 1] ?? "");
const rest = stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--out", true), "--full-page"), "--help"), "-h");

if (help || rest.length > 0 || (outIndex !== -1 && !args[outIndex + 1])) {
	console.log(`Usage: screenshot.js [--full-page] [--out path.png] [--port 9222 | --cdp http://host:9222]\n\nCapture the active tab viewport as a PNG and print the file path.\nDefaults to .browser-tools/screenshots/<timestamp>.png in the current directory.`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Page.enable");
		let params = { format: "png", fromSurface: true };
		if (fullPage) {
			const { contentSize } = await client.send("Page.getLayoutMetrics");
			const width = Math.max(1, Math.ceil(contentSize.width));
			const height = Math.max(1, Math.ceil(contentSize.height));
			await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
			params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } };
		}
		const { data } = await client.send("Page.captureScreenshot", params);
		if (fullPage) await client.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
		mkdirSync(resolve(outPath, ".."), { recursive: true });
		writeFileSync(outPath, Buffer.from(data, "base64"));
	});
	console.log(outPath);
} catch (error) {
	fail(error);
}

function defaultPath() {
	const baseDir = process.env.BROWSER_TOOLS_OUTPUT_DIR ? resolve(process.env.BROWSER_TOOLS_OUTPUT_DIR) : resolve(process.cwd(), ".browser-tools");
	const dir = join(baseDir, "screenshots");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return join(dir, `screenshot-${timestamp}.png`);
}
