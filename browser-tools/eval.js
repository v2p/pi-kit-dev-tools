#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fail, parseCdpUrl, printValue, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const jsonOnly = args.includes("--json");
const help = args.includes("--help") || args.includes("-h");
const fileIndex = args.indexOf("--file");
const codeFromFile = fileIndex === -1 ? undefined : args[fileIndex + 1];
const rest = stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--file", true), "--help"), "-h");
const code = !help && codeFromFile ? readFileSync(codeFromFile, "utf8") : rest.join(" ");

if (help || !code || (codeFromFile && rest.length > 0) || (fileIndex !== -1 && !codeFromFile)) {
	console.log(`Usage: eval.js [--json] [--file script.js] [--port 9222 | --cdp http://host:9222] 'code'\n\nEvaluate JavaScript in the active tab. The code is treated as an async expression;\nif that is not valid syntax, it is treated as an async function body.\n\nExamples:\n  eval.js 'document.title'\n  eval.js 'await fetch(location.href).then(r => r.status)'\n  eval.js 'const links = [...document.links]; return links.map(a => a.href)'\n  eval.js --file ./inspect-page.js --json`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Runtime.enable");
		const expression = `
(async () => {
  const source = ${JSON.stringify(code)};
  const AsyncFunction = (async () => {}).constructor;
  try {
    return await new AsyncFunction("return (" + source + ")")();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return await new AsyncFunction(source)();
  }
})()`;
		const response = await client.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});

		if (response.exceptionDetails) {
			throw new Error(formatException(response.exceptionDetails));
		}

		const result = response.result;
		if (Object.hasOwn(result, "value")) {
			if (jsonOnly) console.log(JSON.stringify(result.value, null, 2));
			else printValue(result.value);
		} else {
			console.log(result.unserializableValue ?? result.description ?? "undefined");
		}
	});
} catch (error) {
	fail(error);
}

function formatException(details) {
	const text = details.exception?.description ?? details.text ?? "Evaluation failed";
	return text.replace(/^Error: /, "");
}
