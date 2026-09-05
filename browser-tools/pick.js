#!/usr/bin/env node

import { connectionLabel, fail, parseCdpUrl, printValue, stripCdpOptions, stripOption, withActivePage } from "./lib/cdp.js";

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");
const help = args.includes("--help") || args.includes("-h");
const timeoutValue = optionValue(args, "--timeout");
const timeout = args.includes("--timeout") && timeoutValue === undefined ? NaN : parseTimeout(timeoutValue ?? "0");
const rest = stripOption(stripOption(stripOption(stripOption(stripOption(stripOption(stripCdpOptions(args), "--json"), "--timeout", true), "--help"), "-h"), "--headed"), "--no-auto-cdp");
const message = rest.join(" ");
const pickHelperSource = browserToolsPick.toString();

if (help || !message || !Number.isFinite(timeout)) {
	console.log(`Usage: pick.js [--json] [--timeout 60000|60s|2m] [--no-auto-cdp] [--port 9222 | --cdp http://host:9222] 'message'\n\nInteractive element picker in the active tab. Hover highlights elements. Click\npicks one element; Cmd/Ctrl/Shift+click or Space toggles multi-selection;\nEnter/Done finishes; Escape/Cancel returns null. Arrow keys refine the hovered\nelement (parent/child/siblings). Best used with a visible host browser from\nDocker/Pi. Without an explicit CDP option, pick.js auto-tries\nBROWSER_TOOLS_CDP_URL, host.docker.internal:9223, and 127.0.0.1:9222.`);
	process.exit(help ? 0 : 1);
}

try {
	const browserUrl = await resolveBrowserUrl(args);
	await withActivePage(browserUrl, async (client, page) => {
		await client.send("Runtime.enable");
		await client.send("Page.bringToFront").catch(() => {});

		console.error(`endpoint: ${connectionLabel(browserUrl)}`);
		console.error(`active page: ${truncate(page.title || "(untitled)", 100)}`);
		console.error(`url: ${truncate(page.url || "", 180)}`);
		console.error(`Waiting for browser selection... hover to inspect, click to pick, Enter to finish, Esc to cancel${timeout > 0 ? `, timeout ${formatDuration(timeout)}` : ""}.`);

		const response = await client.send("Runtime.evaluate", {
			expression: `(${pickHelperSource})(${JSON.stringify({ message, timeout })})`,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);

		const result = response.result.value;
		const hasEnvelope = result && typeof result === "object" && Object.hasOwn(result, "value") && Object.hasOwn(result, "reason");
		const value = hasEnvelope ? result.value : result;
		const reason = hasEnvelope ? result.reason : "selected";
		if (value === null) {
			console.error(reason === "timeout" ? "Picker timed out without a selection." : reason === "replaced" ? "Picker was replaced by another picker." : "Picker cancelled without a selection.");
		} else if (Array.isArray(value)) {
			console.error(`Selected ${value.length} element${value.length === 1 ? "" : "s"}.`);
		} else {
			console.error(`Selected ${value.selector ?? value.tag ?? "element"}.`);
		}

		if (jsonOnly) console.log(JSON.stringify(value, null, 2));
		else printValue(value);
	});
} catch (error) {
	fail(error);
}

async function resolveBrowserUrl(argv) {
	const explicit = hasOption(argv, "--cdp") || hasOption(argv, "--browser-url") || hasOption(argv, "--port") || hasOption(argv, "--no-auto-cdp");
	if (explicit) return parseCdpUrl(argv);

	const candidates = unique([process.env.BROWSER_TOOLS_CDP_URL, "http://host.docker.internal:9223", "http://127.0.0.1:9222"]);
	for (const candidate of candidates) {
		if (await readyWithin(candidate, 900)) return candidate;
	}

	throw new Error(`Could not auto-detect a CDP endpoint for pick.js.\nTried: ${candidates.map(safeConnectionLabel).join(", ")}\n\nFor a visible host Chrome from Docker/Pi, run on the host:\n  make -f docker-kit/host.Makefile chrome-debug\n  make -f docker-kit/host.Makefile cdp-relay\n\nThen rerun pick.js, or pass --cdp http://host.docker.internal:9223 explicitly.`);
}

function safeConnectionLabel(browserUrl) {
	try {
		return connectionLabel(browserUrl);
	} catch {
		return String(browserUrl);
	}
}

async function readyWithin(browserUrl, timeoutMs) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const base = normalizeBrowserUrl(browserUrl);
		const response = await fetch(new URL("/json/version", base).toString(), {
			headers: { Connection: "close" },
			signal: controller.signal,
		});
		await response.arrayBuffer().catch(() => {});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}

function normalizeBrowserUrl(value) {
	const stringValue = String(value);
	const withProtocol = /^https?:\/\//i.test(stringValue) ? stringValue : `http://${stringValue}`;
	const url = new URL(withProtocol);
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url;
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function hasOption(argv, name) {
	return argv.includes(name);
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function parseTimeout(value) {
	const text = String(value).trim().toLowerCase();
	const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
	if (!match) return NaN;
	const amount = Number(match[1]);
	const unit = match[2] ?? "ms";
	const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1000 : 1;
	return Math.max(0, Math.round(amount * multiplier));
}

function formatDuration(ms) {
	if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
	if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function truncate(value, length) {
	return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function browserToolsPick({ message, timeout }) {
	return new Promise((resolve) => {
		const PICKER_KEY = "__browserToolsPickCleanup";
		const PICKER_ATTR = "data-browser-tools-picker";
		const PICKER_SELECTOR = `[${PICKER_ATTR}]`;
		try {
			if (typeof window[PICKER_KEY] === "function") window[PICKER_KEY]("replaced");
		} catch {}
		for (const node of document.querySelectorAll(PICKER_SELECTOR)) node.remove();

		const selectionOrder = [];
		const selectedElements = new Set();
		let currentElement = null;
		let lastPoint = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
		let finished = false;
		let timeoutId = null;
		let bannerAtTop = false;

		const overlay = document.createElement("div");
		overlay.setAttribute(PICKER_ATTR, "overlay");
		overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:12px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:white";

		const selectedLayer = document.createElement("div");
		selectedLayer.style.cssText = "position:fixed;inset:0;pointer-events:none";
		overlay.appendChild(selectedLayer);

		const highlight = document.createElement("div");
		highlight.style.cssText = "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.14);box-shadow:0 0 0 1px rgba(255,255,255,.85),0 0 0 99999px rgba(15,23,42,.03);transition:top 70ms,left 70ms,width 70ms,height 70ms;box-sizing:border-box;display:none";
		overlay.appendChild(highlight);

		const tooltip = document.createElement("div");
		tooltip.style.cssText = "position:fixed;z-index:2147483647;display:none;pointer-events:none;max-width:min(520px,calc(100vw - 24px));white-space:pre-wrap;background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:8px 10px;box-shadow:0 8px 24px rgba(0,0,0,.35);line-height:1.35";
		overlay.appendChild(tooltip);

		const banner = document.createElement("div");
		banner.setAttribute(PICKER_ATTR, "banner");
		banner.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111827;color:white;padding:12px 14px;border-radius:10px;font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.35);z-index:2147483647;pointer-events:auto;max-width:min(92vw,980px);min-width:min(560px,92vw);display:flex;gap:12px;align-items:center";

		const bannerText = document.createElement("div");
		bannerText.style.cssText = "flex:1;min-width:0";
		const promptLine = document.createElement("div");
		promptLine.style.cssText = "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
		const helpLine = document.createElement("div");
		helpLine.style.cssText = "margin-top:3px;color:#cbd5e1;font-size:12px;line-height:1.35";
		bannerText.append(promptLine, helpLine);

		const doneButton = makeButton("Done");
		const cancelButton = makeButton("Cancel");
		const collapseButton = makeButton("Hide help");
		let collapsed = false;
		doneButton.addEventListener("click", () => finish(currentResult()));
		cancelButton.addEventListener("click", () => finish(null, "cancelled"));
		collapseButton.addEventListener("click", () => {
			collapsed = !collapsed;
			collapseButton.textContent = collapsed ? "Show help" : "Hide help";
			updateBanner();
		});
		banner.append(bannerText, doneButton, cancelButton, collapseButton);

		document.documentElement.append(overlay, banner);
		window[PICKER_KEY] = finishWithoutSelection;

		if (timeout > 0) timeoutId = setTimeout(() => finish(null, "timeout"), timeout);

		updateBanner();

		document.addEventListener("mousemove", onMove, true);
		document.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("scroll", onViewportChange, true);
		window.addEventListener("resize", onViewportChange, true);

		function makeButton(label) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = label;
			button.setAttribute(PICKER_ATTR, "button");
			button.style.cssText = "appearance:none;border:1px solid rgba(255,255,255,.28);border-radius:8px;background:#334155;color:white;padding:7px 10px;font:12px system-ui,sans-serif;cursor:pointer;white-space:nowrap";
			button.addEventListener("mouseenter", () => button.style.background = "#475569");
			button.addEventListener("mouseleave", () => button.style.background = "#334155");
			return button;
		}

		function updateBanner() {
			promptLine.textContent = message;
			helpLine.textContent = collapsed
				? `${selectionOrder.length} selected. Hover/select in page; Show help for keys.`
				: `${selectionOrder.length} selected • Click picks current • Cmd/Ctrl/Shift+Click or Space adds/removes • ↑ parent ↓ child ←/→ siblings • Backspace removes last • Enter/Done finishes • Esc cancels`;
			doneButton.textContent = selectionOrder.length > 0 ? `Done (${selectionOrder.length})` : "Pick current";
			doneButton.disabled = !currentElement && selectionOrder.length === 0;
			doneButton.style.opacity = doneButton.disabled ? ".55" : "1";
			doneButton.style.cursor = doneButton.disabled ? "not-allowed" : "pointer";
		}

		function cleanup() {
			clearTimeout(timeoutId);
			document.removeEventListener("mousemove", onMove, true);
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange, true);
			overlay.remove();
			banner.remove();
			if (window[PICKER_KEY] === finishWithoutSelection) delete window[PICKER_KEY];
		}

		function finishWithoutSelection(reason) {
			finish(null, reason);
		}

		function finish(value, reason = "selected") {
			if (finished) return;
			finished = true;
			cleanup();
			resolve({ value, reason });
		}

		function currentResult() {
			if (selectionOrder.length > 0) return selectionOrder.map(buildElementInfo);
			return currentElement ? buildElementInfo(currentElement) : null;
		}

		function onMove(event) {
			lastPoint = { x: event.clientX, y: event.clientY };
			const element = elementAtPoint(lastPoint.x, lastPoint.y);
			if (!element) return;
			if (element !== currentElement) setCurrentElement(element);
			else positionTooltip(lastPoint.x, lastPoint.y);
		}

		function onClick(event) {
			if (isPickerNode(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			lastPoint = { x: event.clientX, y: event.clientY };
			const element = elementAtPoint(lastPoint.x, lastPoint.y);
			if (!element) return;
			setCurrentElement(element);
			if (event.metaKey || event.ctrlKey || event.shiftKey) {
				toggleSelection(element);
			} else {
				finish(currentResult());
			}
		}

		function onKey(event) {
			if (isPickerNode(event.target) && event.key !== "Escape") return;
			if (event.key === "Escape") {
				event.preventDefault();
				finish(null, "cancelled");
			} else if (event.key === "Enter") {
				event.preventDefault();
				finish(currentResult());
			} else if (event.key === " " || event.key === "Spacebar") {
				event.preventDefault();
				if (currentElement) toggleSelection(currentElement);
			} else if (event.key === "Backspace" || event.key === "Delete") {
				event.preventDefault();
				removeLastSelection();
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				refineToAncestor();
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				refineToDescendant();
			} else if (event.key === "ArrowLeft") {
				event.preventDefault();
				refineToSibling(-1);
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				refineToSibling(1);
			}
		}

		function onViewportChange() {
			updateHighlight();
			updateSelectedBadges();
			if (currentElement) positionTooltip(lastPoint.x, lastPoint.y);
		}

		function setCurrentElement(element) {
			if (!isPickableElement(element)) return;
			currentElement = element;
			updateHighlight();
			updateTooltip();
			updateBanner();
		}

		function updateHighlight() {
			if (!currentElement || !currentElement.isConnected) {
				highlight.style.display = "none";
				tooltip.style.display = "none";
				return;
			}
			const rect = currentElement.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				highlight.style.display = "none";
				return;
			}
			highlight.style.display = "block";
			highlight.style.top = `${Math.round(rect.top)}px`;
			highlight.style.left = `${Math.round(rect.left)}px`;
			highlight.style.width = `${Math.round(rect.width)}px`;
			highlight.style.height = `${Math.round(rect.height)}px`;
			placeBanner(rect);
		}

		function updateTooltip() {
			if (!currentElement) return;
			const info = lightweightElementInfo(currentElement);
			const lines = [
				info.label,
				info.text ? `text: ${info.text}` : null,
				info.aria ? `aria: ${info.aria}` : null,
				`selector: ${info.selector}`,
				info.selectorCount === null ? "matches: unknown" : `matches: ${info.selectorCount}${info.selectorCount === 1 ? " (unique)" : ""}`,
				"keys: ↑ parent · ↓ child · ←/→ sibling · Space toggle",
			].filter(Boolean);
			tooltip.textContent = lines.join("\n");
			tooltip.style.display = "block";
			positionTooltip(lastPoint.x, lastPoint.y);
		}

		function positionTooltip(x, y) {
			if (tooltip.style.display === "none") return;
			const margin = 12;
			let left = x + 14;
			let top = y + 14;
			const width = tooltip.offsetWidth || 320;
			const height = tooltip.offsetHeight || 120;
			if (left + width + margin > window.innerWidth) left = x - width - 14;
			if (top + height + margin > window.innerHeight) top = y - height - 14;
			left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
			top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
			tooltip.style.left = `${Math.round(left)}px`;
			tooltip.style.top = `${Math.round(top)}px`;
		}

		function placeBanner(rect) {
			const shouldMoveTop = rect.bottom > window.innerHeight - 125;
			if (shouldMoveTop === bannerAtTop) return;
			bannerAtTop = shouldMoveTop;
			if (bannerAtTop) {
				banner.style.top = "20px";
				banner.style.bottom = "auto";
			} else {
				banner.style.top = "auto";
				banner.style.bottom = "20px";
			}
		}

		function toggleSelection(element) {
			if (selectedElements.has(element)) {
				selectedElements.delete(element);
				selectionOrder.splice(selectionOrder.indexOf(element), 1);
			} else {
				selectedElements.add(element);
				selectionOrder.push(element);
			}
			updateBanner();
			updateSelectedBadges();
		}

		function removeLastSelection() {
			const element = selectionOrder.pop();
			if (element) selectedElements.delete(element);
			updateBanner();
			updateSelectedBadges();
		}

		function updateSelectedBadges() {
			selectedLayer.replaceChildren();
			selectionOrder.forEach((element, index) => {
				if (!element.isConnected) return;
				const rect = element.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;
				const box = document.createElement("div");
				box.style.cssText = `position:fixed;left:${Math.round(rect.left)}px;top:${Math.round(rect.top)}px;width:${Math.round(rect.width)}px;height:${Math.round(rect.height)}px;border:2px solid #10b981;background:rgba(16,185,129,.12);box-sizing:border-box;border-radius:2px`;
				const badge = document.createElement("div");
				badge.textContent = String(index + 1);
				badge.style.cssText = "position:absolute;left:-10px;top:-10px;min-width:20px;height:20px;border-radius:999px;background:#10b981;color:white;display:grid;place-items:center;font:700 12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)";
				box.appendChild(badge);
				selectedLayer.appendChild(box);
			});
		}

		function refineToAncestor() {
			if (!currentElement) return;
			const stack = elementsAtPoint(lastPoint.x, lastPoint.y);
			const index = stack.indexOf(currentElement);
			const ancestor = index >= 0 ? stack.slice(index + 1).find(isPickableElement) : currentElement.parentElement;
			if (ancestor) setCurrentElement(ancestor);
		}

		function refineToDescendant() {
			if (!currentElement) return;
			const stack = elementsAtPoint(lastPoint.x, lastPoint.y);
			const index = stack.indexOf(currentElement);
			const descendant = index > 0 ? stack[index - 1] : [...currentElement.querySelectorAll("*")].find(isVisibleElement);
			if (descendant) setCurrentElement(descendant);
		}

		function refineToSibling(direction) {
			if (!currentElement?.parentElement) return;
			const siblings = [...currentElement.parentElement.children].filter(isVisibleElement);
			if (siblings.length <= 1) return;
			const index = siblings.indexOf(currentElement);
			const next = siblings[(index + direction + siblings.length) % siblings.length];
			if (!next) return;
			next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
			const rect = next.getBoundingClientRect();
			lastPoint = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
			setCurrentElement(next);
		}

		function elementAtPoint(x, y) {
			return elementsAtPoint(x, y)[0] ?? null;
		}

		function elementsAtPoint(x, y) {
			const previousOverlayDisplay = overlay.style.display;
			const previousBannerDisplay = banner.style.display;
			overlay.style.display = "none";
			banner.style.display = "none";
			const elements = document.elementsFromPoint(x, y).filter(isPickableElement);
			overlay.style.display = previousOverlayDisplay;
			banner.style.display = previousBannerDisplay;
			return elements;
		}

		function isPickerNode(node) {
			return node?.nodeType === Node.ELEMENT_NODE && Boolean(node.closest(PICKER_SELECTOR));
		}

		function isPickableElement(element) {
			return element?.nodeType === Node.ELEMENT_NODE && !isPickerNode(element) && element !== document.documentElement;
		}

		function isVisibleElement(element) {
			if (!isPickableElement(element)) return false;
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
		}

		function lightweightElementInfo(element) {
			const selector = cssPath(element);
			const count = selectorCount(selector);
			const id = element.id ? `#${element.id}` : "";
			const classes = (element.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).map((name) => `.${name}`).join("");
			const role = element.getAttribute("role");
			const aria = element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title");
			return {
				label: `${element.tagName.toLowerCase()}${id}${classes}${role ? ` [role=${role}]` : ""}`,
				aria: aria ? truncateText(aria, 100) : null,
				text: elementText(element, 100),
				selector,
				selectorCount: count,
			};
		}

		function buildElementInfo(element) {
			const rect = element.getBoundingClientRect();
			const selector = cssPath(element);
			const count = selectorCount(selector);
			return {
				tag: element.tagName.toLowerCase(),
				id: element.id || null,
				class: element.getAttribute("class") || null,
				name: element.getAttribute("name"),
				type: element.getAttribute("type"),
				role: element.getAttribute("role"),
				ariaLabel: element.getAttribute("aria-label"),
				accessibleName: accessibleName(element),
				text: elementText(element, 240),
				href: elementHref(element),
				selector,
				selectorCount: count,
				selectorUnique: count === 1,
				alternativeSelectors: alternativeSelectors(element, selector),
				xpath: xPath(element),
				rect: {
					x: Math.round(rect.x),
					y: Math.round(rect.y),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				},
				center: {
					x: Math.round(rect.left + rect.width / 2),
					y: Math.round(rect.top + rect.height / 2),
				},
				page: {
					title: document.title,
					url: location.href,
				},
				frame: {
					url: location.href,
					isTop: isTopFrame(),
				},
				html: element.outerHTML.slice(0, 800),
			};
		}

		function alternativeSelectors(element, primarySelector) {
			const selectors = [];
			const push = (type, selector) => {
				if (!selector || selectors.some((entry) => entry.selector === selector)) return;
				const count = selectorCount(selector);
				selectors.push({ type, selector, count, unique: count === 1 });
			};
			push("css", primarySelector);
			if (element.id) push("id", `#${CSS.escape(element.id)}`);
			for (const attr of ["data-testid", "data-test", "data-qa", "data-cy", "name", "aria-label", "title", "alt"]) {
				const value = element.getAttribute(attr);
				if (value) push(attr, `[${attr}=${cssString(value)}]`);
			}
			const role = element.getAttribute("role");
			if (role) push("role", `[role=${cssString(role)}]`);
			return selectors;
		}

		function cssPath(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
			if (element.id) return `#${CSS.escape(element.id)}`;
			const parts = [];
			let current = element;
			while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
				let part = current.localName;
				const classes = [...current.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("");
				part += classes;
				const parent = current.parentElement;
				const siblings = parent ? [...parent.children].filter((child) => child.localName === current.localName) : [];
				if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
				parts.unshift(part);
				current = parent;
			}
			return parts.join(" > ");
		}

		function xPath(element) {
			if (element.id) return `//*[@id=${xpathString(element.id)}]`;
			const parts = [];
			let current = element;
			while (current && current.nodeType === Node.ELEMENT_NODE) {
				const tag = current.localName;
				const parent = current.parentElement;
				if (!parent) {
					parts.unshift(tag);
					break;
				}
				const siblings = [...parent.children].filter((child) => child.localName === tag);
				parts.unshift(siblings.length > 1 ? `${tag}[${siblings.indexOf(current) + 1}]` : tag);
				current = parent;
			}
			return `/${parts.join("/")}`;
		}

		function xpathString(value) {
			if (!value.includes("'")) return `'${value}'`;
			return `concat('${value.split("'").join(`',"'",'`)}')`;
		}

		function selectorCount(selector) {
			try {
				return selector ? document.querySelectorAll(selector).length : null;
			} catch {
				return null;
			}
		}

		function cssString(value) {
			return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
		}

		function elementText(element, maxLength) {
			const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
			return truncateText(text, maxLength) || null;
		}

		function truncateText(value, maxLength) {
			return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
		}

		function accessibleName(element) {
			return element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title") || elementText(element, 120);
		}

		function elementHref(element) {
			return typeof element.href === "string" ? element.href : element.getAttribute("href");
		}

		function isTopFrame() {
			try {
				return window.top === window;
			} catch {
				return false;
			}
		}
	});
}
