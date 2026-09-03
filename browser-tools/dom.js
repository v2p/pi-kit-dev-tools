#!/usr/bin/env node

import { fail, parseCdpUrl, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const browserUrl = parseCdpUrl(args);
const help = args.includes("--help") || args.includes("-h");
const jsonOnly = args.includes("--json");
const includeHidden = args.includes("--include-hidden");
const selector = optionValue(args, "--selector") ?? "a,button,input,textarea,select,label,h1,h2,h3,h4,h5,h6,p,li,td,th,[role],[aria-label],[name]";
const textFilter = optionValue(args, "--text");
const limit = Number(optionValue(args, "--limit") ?? 80);
const rest = ["--json", "--include-hidden", "--help", "-h"]
	.reduce((list, option) => stripOption(list, option), stripOption(stripOption(stripOption(stripCdpOptions(args), "--selector", true), "--text", true), "--limit", true));

if (help || rest.length > 0 || !Number.isFinite(limit) || limit < 1) {
	console.log(`Usage: dom.js [options] [--port 9222 | --cdp http://host:9222]\n\nDump a concise DOM summary from the active tab. Useful as a headless replacement\nfor interactive picking.\n\nOptions:\n  --selector <css>       CSS selector to inspect\n  --text <substring>    Keep elements containing text\n  --limit <n>           Max elements (default: 80)\n  --include-hidden      Include hidden elements\n  --json                Print full JSON`);
	process.exit(help ? 0 : 1);
}

try {
	await withActivePage(browserUrl, async (client) => {
		await client.send("Runtime.enable");
		const response = await client.send("Runtime.evaluate", {
			expression: `(${domSummary.toString()})(${JSON.stringify({ selector, textFilter, limit, includeHidden })})`,
			awaitPromise: true,
			returnByValue: true,
		});
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
		const elements = response.result.value ?? [];
		if (jsonOnly) {
			console.log(JSON.stringify(elements, null, 2));
		} else {
			for (const element of elements) console.log(toLine(element));
		}
	});
} catch (error) {
	fail(error);
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function toLine(element) {
	const bits = [`[${element.index}]`, element.tag];
	if (element.id) bits.push(`#${element.id}`);
	if (element.class) bits.push(`.${String(element.class).trim().split(/\s+/).slice(0, 3).join(".")}`);
	if (element.role) bits.push(`role=${element.role}`);
	if (element.name) bits.push(`name=${element.name}`);
	if (element.type) bits.push(`type=${element.type}`);
	if (element.href) bits.push(`href=${truncate(element.href, 80)}`);
	if (element.text) bits.push(`"${truncate(element.text, 140)}"`);
	bits.push(`selector=${truncate(element.selector, 180)}`);
	return bits.join(" ");
}

function truncate(value, length) {
	if (!value) return value;
	return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function domSummary(options) {
	const { selector, textFilter, limit, includeHidden } = options;
	const cssPath = (element) => {
		if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
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

	const isVisible = (element) => {
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
	};

	const className = (element) => typeof element.className === "string" ? element.className : element.getAttribute("class");
	const textOf = (element) => (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
	const lowerTextFilter = textFilter?.toLowerCase();
	const seen = new Set();
	const out = [];

	for (const element of document.querySelectorAll(selector)) {
		if (seen.has(element)) continue;
		seen.add(element);
		if (!includeHidden && !isVisible(element)) continue;
		const text = textOf(element);
		if (lowerTextFilter && !text.toLowerCase().includes(lowerTextFilter)) continue;
		const rect = element.getBoundingClientRect();
		out.push({
			index: out.length,
			tag: element.tagName.toLowerCase(),
			id: element.id || null,
			class: className(element) || null,
			name: element.getAttribute("name"),
			type: element.getAttribute("type"),
			role: element.getAttribute("role"),
			ariaLabel: element.getAttribute("aria-label"),
			placeholder: element.getAttribute("placeholder"),
			href: element.href || null,
			text: text.slice(0, 500) || null,
			selector: cssPath(element),
			rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
		});
		if (out.length >= limit) break;
	}
	return out;
}
