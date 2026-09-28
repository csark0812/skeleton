import { EventEmitter } from "node:events";
import process from "node:process";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

import { runClaudeAgent } from "../index.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => ({
	...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
	spawn: spawnMock,
}));

function successfulChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		pid: undefined;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.pid = undefined;
	child.kill = vi.fn(() => true);
	queueMicrotask(() => {
		child.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", result: "ok" })}\n`);
		child.stdout.end();
		child.stderr.end();
		child.emit("close", 0);
	});
	return child;
}

afterEach(() => {
	delete process.env.CLAUDE_AUTH_MODE;
	delete process.env.ANTHROPIC_API_KEY;
	spawnMock.mockReset();
});

it("refuses to guess an auth mode when a key happens to be present", async () => {
	delete process.env.CLAUDE_AUTH_MODE;
	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
	spawnMock.mockImplementation(successfulChild);
	await expect(runClaudeAgent({ cwd: process.cwd(), prompt: "hi", bin: "claude" })).rejects.toThrow(
		/CLAUDE_AUTH_MODE.*not set/,
	);
	expect(spawnMock).not.toHaveBeenCalled();
});

it("uses subscription auth without forwarding a stale API key", async () => {
	process.env.CLAUDE_AUTH_MODE = "subscription";
	process.env.ANTHROPIC_API_KEY = "sk-ant-stale";
	spawnMock.mockImplementation(successfulChild);
	const result = await runClaudeAgent({ cwd: process.cwd(), prompt: "hi", bin: "claude" });
	expect(result.status).toBe("completed");
	const args = spawnMock.mock.calls[0]?.[1] as string[];
	const options = spawnMock.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
	expect(args).toContain("--strict-mcp-config");
	expect(args).not.toContain("--bare");
	expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
});

it("retains API-key mode's explicit key and bare invocation", async () => {
	process.env.CLAUDE_AUTH_MODE = "api-key";
	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
	spawnMock.mockImplementation(successfulChild);
	const result = await runClaudeAgent({ cwd: process.cwd(), prompt: "hi", bin: "claude" });
	expect(result.status).toBe("completed");
	const args = spawnMock.mock.calls[0]?.[1] as string[];
	const options = spawnMock.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
	expect(args).toContain("--bare");
	expect(options.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
});
