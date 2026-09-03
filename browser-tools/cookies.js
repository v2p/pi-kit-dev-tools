#!/usr/bin/env node

import { fail, parseCdpUrl, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const all = args.includes("--all");
const help = args.includes("--help") || args.includes("-h");
const rest = stripOption(stripOption(stripOption(stripCdpOptions(args), "--all"), "--help"), "-h");

if (help || rest.length > 0) {
	console.log(`Usage: cookies.js [--all] [--port 9222 | --cdp http://host:9222]\n\nPrint cookies as JSON. By default prints cookies visible to the active tab URL,\nincluding HTTP-only cookies available through CDP. Use --all for all browser cookies.`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Network.enable");
		let cookies;
		if (all) {
			({ cookies } = await client.send("Network.getAllCookies"));
		} else {
			await client.send("Runtime.enable");
			const response = await client.send("Runtime.evaluate", { expression: "location.href", returnByValue: true });
			if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
			({ cookies } = await client.send("Network.getCookies", { urls: [response.result.value] }));
		}
		console.log(JSON.stringify(cookies, null, 2));
	});
} catch (error) {
	fail(error);
}
