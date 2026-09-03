#!/usr/bin/env node

import { fail, parseCdpUrl, printValue, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const help = args.includes("--help") || args.includes("-h");
const jsonOnly = args.includes("--json");
const selector = optionValue(args, "--selector");
const text = optionValue(args, "--text");
const timeout = Number(optionValue(args, "--timeout") ?? 10000);
const rest = stripOption(stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--selector", true), "--text", true), "--timeout", true), "--help").filter((arg) => arg !== "-h");

if (help || rest.length > 0 || (!selector && !text) || !Number.isFinite(timeout)) {
	console.log(`Usage: wait.js (--selector <css> | --text <substring>) [--timeout 10000] [--json] [--port 9222 | --cdp http://host:9222]\n\nWait for a visible selector or text in the active tab.`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Runtime.enable");
		const response = await client.send("Runtime.evaluate", {
			expression: `(${waitForMatch.toString()})(${JSON.stringify({ selector, text, timeout })})`,
			awaitPromise: true,
			returnByValue: true,
		});
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
		if (jsonOnly) console.log(JSON.stringify(response.result.value, null, 2));
		else printValue(response.result.value);
	});
} catch (error) {
	fail(error);
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function waitForMatch({ selector, text, timeout }) {
	const cssPath = (element) => {
		if (element.id) return `#${CSS.escape(element.id)}`;
		const parts = [];
		let current = element;
		while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
			let part = current.localName;
			const parent = current.parentElement;
			const siblings = parent ? [...parent.children].filter((child) => child.localName === current.localName) : [];
			if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
			parts.unshift(part);
			current = parent;
		}
		return parts.join(" > ");
	};
	const visible = (element) => {
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
	};
	const info = (element) => ({
		selector: cssPath(element),
		tag: element.tagName.toLowerCase(),
		text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240) || null,
	});
	const lowerText = text?.toLowerCase();
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeout;
		const tick = () => {
			let element = null;
			if (selector) element = document.querySelector(selector);
			if (element && visible(element)) return resolve(info(element));
			if (lowerText) {
				element = [...document.querySelectorAll("body *")].find((candidate) => visible(candidate) && (candidate.innerText || candidate.textContent || "").toLowerCase().includes(lowerText));
				if (element) return resolve(info(element));
			}
			if (Date.now() > deadline) reject(new Error(`Timed out waiting for ${selector ? `selector: ${selector}` : `text: ${text}`}`));
			else setTimeout(tick, 100);
		};
		tick();
	});
}
