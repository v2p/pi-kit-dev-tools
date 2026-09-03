#!/usr/bin/env node

import { connectionLabel, fail, getTargets, getVersion, parseCdpUrl, stripCdpOptions, stripOption } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const jsonOnly = args.includes("--json");
const help = args.includes("--help") || args.includes("-h");
const rest = stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--help"), "-h");

if (help || rest.length > 0) {
	console.log(`Usage: status.js [--json] [--port 9222 | --cdp http://host:9222]\n\nCheck the CDP browser connection and list page targets. The last page is the\ndefault active tab used by the other tools.`);
	process.exit(help ? 0 : 1);
}

try {
	const [version, targets] = await Promise.all([getVersion(browserUrl), getTargets(browserUrl)]);
	const pages = targets.filter((target) => target.type === "page" && !target.url?.startsWith("devtools://"));
	if (jsonOnly) {
		console.log(JSON.stringify({ endpoint: connectionLabel(browserUrl), version, pages }, null, 2));
	} else {
		console.log(`endpoint: ${connectionLabel(browserUrl)}`);
		console.log(`browser: ${version.Browser ?? "unknown"}`);
		console.log(`pages: ${pages.length}`);
		for (const [index, page] of pages.entries()) {
			const marker = index === pages.length - 1 ? "*" : " ";
			console.log(`${marker} [${index}] ${truncate(page.title || "(untitled)", 60)}`);
			console.log(`    id: ${page.id}`);
			console.log(`    url: ${page.url}`);
		}
	}
} catch (error) {
	fail(error);
}

function truncate(value, length) {
	return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
