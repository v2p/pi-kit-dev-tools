import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
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

for (const tool of tools) {
	test(`${tool}.js prints help`, async () => {
		const { stdout } = await execFileAsync(join(toolsDir, `${tool}.js`), ["--help"], { cwd: root });
		assert.match(stdout, new RegExp(`Usage: ${tool}\\.js`));
	});
}
