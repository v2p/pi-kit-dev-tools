import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const toolsDir = join(root, "browser-tools");
const tools = ["start", "status", "nav", "eval", "screenshot", "dom", "click", "type", "wait", "pick", "cookies"];

test("browser-tools directory contains only short .js tools plus lib", async () => {
	const entries = await readdir(toolsDir, { withFileTypes: true });
	const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
	assert.deepEqual(fileNames, tools.map((tool) => `${tool}.js`).sort());
	assert.ok(entries.some((entry) => entry.isDirectory() && entry.name === "lib"));
});

test("kit builder packages v3 image assets and workspace lifecycle hook", async () => {
	const temp = await mkdtemp(join(tmpdir(), "browser-tools-kit-"));
	const output = join(temp, "kit");
	try {
		await execFileAsync(join(root, "scripts/build-docker-kit.sh"), [output]);
		const spec = await readFile(join(output, "spec.yaml"), "utf8");
		assert.match(spec, /^# syntax=docker\/sandbox-kit:3\nschemaVersion: "3"/);
		assert.match(spec, /FROM scratch\n  COPY files\/workspace\/ \/opt\/pi-browser-tools\/workspace\//);
		for (const capability of ["network-policy", "lifecycle", "agent-context"]) {
			assert.ok(spec.includes(`com.docker.sandbox/${capability}@1`));
		}
		assert.match(spec, /env: \[WORKSPACE_DIR\]/);
		assert.match(spec, /cp -R \/opt\/pi-browser-tools\/workspace\/\. "\$WORKSPACE_DIR\/"/);
		assert.doesNotMatch(spec, /^(permissions|agentInstructions|setup|name):/m);
		for (const tool of tools) {
			const path = join(output, "files/workspace/browser-tools", `${tool}.js`);
			assert.ok((await stat(path)).mode & 0o111);
		}
		for (const path of [
			"files/workspace/browser-tools/lib/cdp.js",
			"files/workspace/.agents/skills/browser-tools/SKILL.md",
			"host.Makefile",
			"host/cdp-relay.js",
		]) {
			assert.ok((await stat(join(output, path))).isFile());
		}
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

for (const tool of tools) {
	test(`${tool}.js prints help`, async () => {
		const { stdout } = await execFileAsync(join(toolsDir, `${tool}.js`), ["--help"], { cwd: root });
		assert.match(stdout, new RegExp(`Usage: ${tool}\\.js`));
	});
}
