#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, openSync, readFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fail, isDebuggingReady, parsePort, stripOption, waitForDebugging, sleep } from "./lib/cdp.js";

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const useProfile = args.includes("--profile");
const resetProfile = args.includes("--reset");
const killExisting = args.includes("--kill");
const headless = args.includes("--headless") || (!args.includes("--headed") && platform() === "linux" && !process.env.DISPLAY);
const noBrowserProxy = args.includes("--no-proxy") || process.env.BROWSER_TOOLS_NO_PROXY === "1";
const browserProxy = noBrowserProxy ? undefined : browserProxyServer();
const port = parsePort(args);
const executable = optionValue(args, "--executable") ?? process.env.BROWSER_TOOLS_CHROME ?? process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? findBrowserExecutable();
const userDataDir = optionValue(args, "--user-data-dir") ?? defaultUserDataDir(useProfile);

const remaining = ["--profile", "--reset", "--kill", "--headless", "--headed", "--no-proxy", "--help", "-h"]
	.reduce(
		(list, option) => stripOption(list, option),
		stripOption(stripOption(stripOption(args, "--port", true), "--executable", true), "--user-data-dir", true),
	);

if (help || remaining.length > 0) {
	console.log(`Usage: start.js [options]\n\nStart Chrome/Chromium with CDP remote debugging on :9222.\n\nOptions:\n  --profile              Copy your default Chrome/Chromium profile first\n  --reset                Delete the tool profile before starting\n  --kill                 Kill a browser previously started on this port\n  --headless             Force headless mode\n  --headed               Force headed mode\n  --port <port>          Remote debugging port (default: 9222)\n  --executable <path>    Browser executable path\n  --user-data-dir <dir>  Profile directory for this browser session\n  --no-proxy            Do not pass HTTP_PROXY/HTTPS_PROXY to Chrome\n\nEnvironment:\n  BROWSER_TOOLS_CHROME, CHROME_PATH, or PUPPETEER_EXECUTABLE_PATH can point to Chrome/Chromium.\n  In Docker Sandbox, HTTP_PROXY/HTTPS_PROXY is passed to Chrome by default so page loads use sandbox networking policy.`);
	process.exit(remaining.length > 0 ? 1 : 0);
}

try {
	if (killExisting) {
		killBrowserOnPort(port);
		await sleep(750);
	}

	if (await isDebuggingReady(port)) {
		console.log(`✓ Browser already available on :${port}`);
		process.exit(0);
	}

	if (!executable) {
		throw new Error("Could not find Chrome/Chromium. Install chromium/google-chrome or set BROWSER_TOOLS_CHROME=/path/to/browser.");
	}

	if (resetProfile) rmSync(userDataDir, { recursive: true, force: true });
	mkdirSync(userDataDir, { recursive: true });

	if (useProfile) copyDefaultProfile(userDataDir);

	const logPath = join(tmpdir(), `browser-tools-${port}.log`);
	const logFd = openSync(logPath, "a");
	const browserArgs = [
		`--remote-debugging-port=${port}`,
		"--remote-debugging-address=127.0.0.1",
		`--user-data-dir=${userDataDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-dev-shm-usage",
		"--disable-background-networking",
		"--disable-features=Translate,OptimizationHints",
	];
	if (browserProxy) {
		browserArgs.push(`--proxy-server=${browserProxy}`);
		const bypass = browserProxyBypassList();
		if (bypass) browserArgs.push(`--proxy-bypass-list=${bypass}`);
	}
	if (platform() === "linux") browserArgs.push("--no-sandbox");
	if (headless) browserArgs.push("--headless=new", "--disable-gpu");
	browserArgs.push("about:blank");

	spawn(executable, browserArgs, { detached: true, stdio: ["ignore", logFd, logFd] }).unref();
	await waitForDebugging(port, 20_000);
	console.log(`✓ Browser started on :${port}${headless ? " (headless)" : ""}`);
	console.log(`profile: ${userDataDir}`);
	if (browserProxy) console.log(`proxy: ${browserProxy}`);
	console.log(`log: ${logPath}`);
} catch (error) {
	const logPath = join(tmpdir(), `browser-tools-${port}.log`);
	if (existsSync(logPath)) {
		const tail = readFileSync(logPath, "utf8").split("\n").slice(-12).join("\n").trim();
		if (tail) console.error(`\nLast browser log lines:\n${tail}\n`);
	}
	fail(error);
}

function optionValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function commandPath(command) {
	const result = spawnSync("command", ["-v", command], { shell: true, encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim().split("\n")[0] : undefined;
}

function findBrowserExecutable() {
	const candidates = platform() === "darwin"
		? [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		]
		: platform() === "win32"
			? [
				join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
				join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
				join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
			]
			: ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "brave-browser", "microsoft-edge"].map(commandPath);
	return candidates.find((candidate) => candidate && existsSync(candidate));
}

function defaultUserDataDir(copiedProfile) {
	const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
	return join(cache, copiedProfile ? "browser-tools-profile-copy" : "browser-tools-profile");
}

function defaultProfileSource() {
	const home = homedir();
	const sources = platform() === "darwin"
		? [join(home, "Library/Application Support/Google/Chrome"), join(home, "Library/Application Support/Chromium")]
		: platform() === "win32"
			? [join(process.env.LOCALAPPDATA ?? home, "Google/Chrome/User Data"), join(process.env.LOCALAPPDATA ?? home, "Chromium/User Data")]
			: [join(home, ".config/google-chrome"), join(home, ".config/chromium")];
	return sources.find((source) => existsSync(source));
}

function copyDefaultProfile(destination) {
	const source = defaultProfileSource();
	if (!source) throw new Error("Could not find a default Chrome/Chromium profile to copy");
	mkdirSync(dirname(destination), { recursive: true });

	const excludes = ["Singleton*", "Crashpad", "GrShaderCache", "ShaderCache", "Default/Cache", "Default/Code Cache"];
	const rsync = commandPath("rsync");
	if (rsync) {
		const result = spawnSync(rsync, ["-a", "--delete", ...excludes.flatMap((item) => [`--exclude=${item}`]), `${source}/`, `${destination}/`], { encoding: "utf8" });
		if (result.status !== 0) throw new Error(`rsync profile copy failed: ${result.stderr || result.stdout}`);
	} else {
		rmSync(destination, { recursive: true, force: true });
		const result = spawnSync("cp", ["-a", source, destination], { encoding: "utf8" });
		if (result.status !== 0) throw new Error(`profile copy failed: ${result.stderr || result.stdout}`);
	}
}

function killBrowserOnPort(portNumber) {
	if (platform() === "win32") return;
	spawnSync("pkill", ["-f", `--remote-debugging-port=${portNumber}`], { stdio: "ignore" });
}

function browserProxyServer() {
	return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? process.env.ALL_PROXY ?? process.env.all_proxy;
}

function browserProxyBypassList() {
	const defaults = ["<local>", "localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "gateway.docker.internal"];
	const fromEnv = (process.env.NO_PROXY ?? process.env.no_proxy ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return [...new Set([...defaults, ...fromEnv])].join(";");
}
