#!/usr/bin/env node

import { fail, parseCdpUrl, printValue, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const jsonOnly = args.includes("--json");
const help = args.includes("--help") || args.includes("-h");
const rest = stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--help"), "-h"), "--headed");
const message = rest.join(" ");
const pickHelperSource = browserToolsPick.toString();

if (help || !message) {
	console.log(`Usage: pick.js [--json] [--port 9222 | --cdp http://host:9222] 'message'\n\nInteractive element picker in the active tab. Click to select one element.\nCmd/Ctrl+Click adds multiple elements; Enter finishes; Escape cancels.\nBest used with a visible host browser from Docker/Pi.`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Runtime.enable");
		await client.send("Page.bringToFront").catch(() => {});
		const response = await client.send("Runtime.evaluate", {
			expression: `(${pickHelperSource})(${JSON.stringify(message)})`,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
		if (jsonOnly) console.log(JSON.stringify(response.result.value, null, 2));
		else printValue(response.result.value);
	});
} catch (error) {
	fail(error);
}

function browserToolsPick(message) {
	return new Promise((resolve) => {
		const selections = [];
		const selectedElements = new Set();
		const previousOutlines = new Map();

		const overlay = document.createElement("div");
		overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";

		const highlight = document.createElement("div");
		highlight.style.cssText = "position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.12);transition:all 70ms;box-sizing:border-box";
		overlay.appendChild(highlight);

		const banner = document.createElement("div");
		banner.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:12px 18px;border-radius:8px;font:14px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:2147483647;pointer-events:auto;max-width:min(90vw,900px)";

		const updateBanner = () => {
			banner.textContent = `${message} (${selections.length} selected; click selects; Cmd/Ctrl+click adds; Enter finishes; Esc cancels)`;
		};
		updateBanner();

		document.documentElement.append(overlay, banner);

		const cleanup = () => {
			document.removeEventListener("mousemove", onMove, true);
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKey, true);
			overlay.remove();
			banner.remove();
			for (const [element, outline] of previousOutlines) element.style.outline = outline;
		};

		const cssPath = (element) => {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
			if (element.id) return `#${CSS.escape(element.id)}`;
			const parts = [];
			let current = element;
			while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
				let part = current.localName;
				const classes = [...current.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("");
				part += classes;
				const siblings = [...current.parentElement?.children ?? []].filter((child) => child.localName === current.localName);
				if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
				parts.unshift(part);
				current = current.parentElement;
			}
			return parts.join(" > ");
		};

		const buildElementInfo = (element) => {
			const rect = element.getBoundingClientRect();
			return {
				tag: element.tagName.toLowerCase(),
				id: element.id || null,
				class: element.className || null,
				name: element.getAttribute("name"),
				type: element.getAttribute("type"),
				role: element.getAttribute("role"),
				ariaLabel: element.getAttribute("aria-label"),
				text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240) || null,
				href: element.href || null,
				selector: cssPath(element),
				rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
				html: element.outerHTML.slice(0, 800),
			};
		};

		const elementAt = (event) => {
			overlay.style.display = "none";
			banner.style.display = "none";
			const element = document.elementFromPoint(event.clientX, event.clientY);
			overlay.style.display = "";
			banner.style.display = "";
			return element;
		};

		const onMove = (event) => {
			const element = elementAt(event);
			if (!element) return;
			const rect = element.getBoundingClientRect();
			highlight.style.top = `${rect.top}px`;
			highlight.style.left = `${rect.left}px`;
			highlight.style.width = `${rect.width}px`;
			highlight.style.height = `${rect.height}px`;
		};

		const onClick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			const element = elementAt(event);
			if (!element) return;
			if (event.metaKey || event.ctrlKey) {
				if (!selectedElements.has(element)) {
					selectedElements.add(element);
					previousOutlines.set(element, element.style.outline);
					element.style.outline = "3px solid #10b981";
					selections.push(buildElementInfo(element));
					updateBanner();
				}
			} else {
				const info = selections.length > 0 ? selections : buildElementInfo(element);
				cleanup();
				resolve(info);
			}
		};

		const onKey = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				cleanup();
				resolve(null);
			} else if (event.key === "Enter" && selections.length > 0) {
				event.preventDefault();
				cleanup();
				resolve(selections);
			}
		};

		document.addEventListener("mousemove", onMove, true);
		document.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKey, true);
	});
}
