#!/usr/bin/env node

import { fail, parseCdpUrl, printValue, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const help = args.includes("--help") || args.includes("-h");
const jsonOnly = args.includes("--json");
const clear = args.includes("--clear");
const timeout = Number(optionValue(args, "--timeout") ?? 5000);
const rest = stripOption(stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--clear"), "--timeout", true), "--help"), "-h");
const selector = rest[0];
const text = rest.slice(1).join(" ");

if (help || !selector || rest.length < 2 || !Number.isFinite(timeout)) {
	console.log(`Usage: type.js <selector> <text> [--clear] [--timeout 5000] [--json] [--port 9222 | --cdp http://host:9222]\n\nFocus an element and insert text. Useful in headless mode.`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Runtime.enable");
		const response = await client.send("Runtime.evaluate", {
			expression: `(${focusElement.toString()})(${JSON.stringify({ selector, clear, timeout })})`,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
		const info = response.result.value;
		await client.send("Input.insertText", { text });
		if (jsonOnly) console.log(JSON.stringify({ ...info, typed: text }, null, 2));
		else printValue({ typed: text, into: info.selector });
	});
} catch (error) {
	fail(error);
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function focusElement({ selector, clear, timeout }) {
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
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeout;
		const tick = () => {
			const element = document.querySelector(selector);
			if (element && visible(element)) {
				element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
				element.focus();
				if (clear) {
					if ("value" in element) element.value = "";
					else if (element.isContentEditable) element.textContent = "";
					element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
					element.dispatchEvent(new Event("change", { bubbles: true }));
				}
				resolve({ selector: cssPath(element), tag: element.tagName.toLowerCase(), text: (element.innerText || element.textContent || "").trim().slice(0, 240) || null });
			} else if (Date.now() > deadline) {
				reject(new Error(`Timed out waiting for visible selector: ${selector}`));
			} else {
				setTimeout(tick, 100);
			}
		};
		tick();
	});
}
