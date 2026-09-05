#!/usr/bin/env node

import { fail, parseCdpUrl, printValue, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const help = args.includes("--help") || args.includes("-h");
const jsonOnly = args.includes("--json");
const timeout = Number(optionValue(args, "--timeout") ?? 5000);
const rest = stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--timeout", true), "--help"), "-h");
const selector = rest[0];
let inputEventId = 100_000_000;

if (help || !selector || rest.length > 1 || !Number.isFinite(timeout)) {
	console.log(`Usage: click.js <selector> [--timeout 5000] [--json] [--port 9222 | --cdp http://host:9222]\n\nClick the center of a visible element in the active tab. Useful in headless mode.`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Runtime.enable");
		await client.send("Page.bringToFront").catch(() => {});
		const response = await client.send("Runtime.evaluate", {
			expression: `(${findClickable.toString()})(${JSON.stringify({ selector, timeout })})`,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
		const info = response.result.value;
		const eventTimeout = Math.min(Math.max(timeout, 1000), 5000);
		fireInputEvent(client, { type: "mouseMoved", x: info.center.x, y: info.center.y });
		const pressed = await sendInputEvent(client, { type: "mousePressed", x: info.center.x, y: info.center.y, button: "left", clickCount: 1 }, eventTimeout);
		const released = await sendInputEvent(client, { type: "mouseReleased", x: info.center.x, y: info.center.y, button: "left", clickCount: 1 }, eventTimeout);
		const acknowledged = pressed && released;
		if (!acknowledged) console.error(`Warning: one or more mouse button events did not receive a CDP acknowledgement within ${eventTimeout}ms; the click may still have been delivered.`);
		if (jsonOnly) console.log(JSON.stringify({ ...info, acknowledged }, null, 2));
		else printValue({ clicked: info.selector, text: info.text, acknowledged });
	});
} catch (error) {
	fail(error);
}

async function sendInputEvent(client, params, timeoutMs) {
	try {
		await Promise.race([
			client.send("Input.dispatchMouseEvent", params),
			new Promise((_, reject) => setTimeout(() => reject(new Error("Input.dispatchMouseEvent acknowledgement timed out")), timeoutMs)),
		]);
		return true;
	} catch (error) {
		if (error.message.includes("acknowledgement timed out")) return false;
		throw error;
	}
}

function fireInputEvent(client, params) {
	client.ws.send(JSON.stringify({
		id: inputEventId++,
		method: "Input.dispatchMouseEvent",
		params,
	}));
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function findClickable({ selector, timeout }) {
	const cssPath = (element) => {
		if (element.id) return `#${CSS.escape(element.id)}`;
		const parts = [];
		let current = element;
		while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
			let part = current.localName;
			const classes = [...current.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("");
			part += classes;
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
				const rect = element.getBoundingClientRect();
				resolve({
					selector: cssPath(element),
					text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240) || null,
					center: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
					rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
				});
			} else if (Date.now() > deadline) {
				reject(new Error(`Timed out waiting for visible selector: ${selector}`));
			} else {
				setTimeout(tick, 100);
			}
		};
		tick();
	});
}
