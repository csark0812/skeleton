import { afterEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
	assertQualificationStorage,
	assertStorageBudget,
	groupActive,
	ownerActive,
	processIdentity,
	recoverStorage,
	type StorageManifest,
	type StoragePolicy,
	storagePolicy,
	superviseQualification,
	treeBytes,
} from "../../scripts/efficacy/qualification-storage.ts";

const roots: string[] = [];
const policy: StoragePolicy = {
	warnBytes: 8192,
	runBytes: 16384,
	totalBytes: 32768,
	minFreeBytes: 0,
	recoveryAgeMs: 0,
	pollMs: 100,
};
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "skeleton-storage-test-")));
	roots.push(root);
	const checkout = join(root, "checkout");
	mkdirSync(checkout);
	return { root, checkout, storageRoot: join(root, "owned"), policy };
}
function manifests(root: string): StorageManifest[] {
	return readdirSync(root)
		.filter((id) => existsSync(join(root, id, "owner.json")))
		.map((id) => JSON.parse(readFileSync(join(root, id, "owner.json"), "utf8")));
}
function worker(checkout: string, tail = "") {
	const path = join(checkout, "worker.ts");
	writeFileSync(
		path,
		`import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; writeFileSync(join(process.env.SKELETON_QUALIFICATION_STORAGE!, 'generated'), Buffer.alloc(1024)); ${tail}`,
	);
	return path;
}
async function until(check: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Fixture timed out");
		await Bun.sleep(20);
	}
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("qualification storage ownership", () => {
	it("rejects invalid policy and reports each independent budget boundary", () => {
		expect(() => assertQualificationStorage()).toThrow("supervised launcher");
		expect(() => storagePolicy({ SKELETON_STORAGE_RUN_GIB: "NaN" })).toThrow("finite");
		expect(() => storagePolicy({ SKELETON_STORAGE_POLL_MS: "0" })).toThrow("poll");
		for (const sample of [
			{ bytes: 16385, total: 0, free: 10 },
			{ bytes: 0, total: 32769, free: 10 },
			{ bytes: 0, total: 0, free: 0 },
		]) {
			expect(() => assertStorageBudget(sample, { ...policy, minFreeBytes: 1 })).toThrow(
				"budget exceeded",
			);
		}
	});
	it("cleans repeated successful preparations and preserves durable evidence", async () => {
		const options = fixture();
		const evidence = join(options.checkout, "evidence.json");
		writeFileSync(evidence, "immutable");
		for (let index = 0; index < 3; index++)
			expect(await superviseQualification(worker(options.checkout), [], options)).toBe(0);
		expect(
			manifests(options.storageRoot).every(
				(run) => run.status === "succeeded" && run.cleanedAt && !existsSync(run.payload),
			),
		).toBe(true);
		expect(readFileSync(evidence, "utf8")).toBe("immutable");
		expect(
			readdirSync(join(options.checkout, ".qualification-cache/storage-evidence")),
		).toHaveLength(3);
	});
	it("materializes a checkout-relative source using the actual harness", async () => {
		const options = {
			...fixture(),
			policy: {
				...policy,
				warnBytes: 1024 ** 2,
				runBytes: 2 * 1024 ** 2,
				totalBytes: 4 * 1024 ** 2,
			},
		};
		const harness = resolve("node_modules/@post-print/agent-harness/dist/index.js");
		const entry = worker(
			options.checkout,
			`
   const { mkdirSync } = await import('node:fs');
   const { relative } = await import('node:path');
   const { createSealedWorkspace } = await import(${JSON.stringify(harness)});
   const source = join(process.env.SKELETON_QUALIFICATION_WORKSPACES!, 'source');
   mkdirSync(source); writeFileSync(join(source, 'proof.txt'), 'contract');
   const sealed = await createSealedWorkspace({ callerCwd: process.cwd(), workspace: relative(process.cwd(), source), overlayPaths: [] });
   try { const { readFileSync } = await import('node:fs'); if (readFileSync(join(sealed.path, 'proof.txt'), 'utf8') !== 'contract') throw new Error('Source missing'); }
   finally { await sealed.cleanup(); }
  `,
		);
		const code = await superviseQualification(entry, [], options);
		expect({ code, manifest: manifests(options.storageRoot)[0].reason }).toEqual({
			code: 0,
			manifest: undefined,
		});
		expect(manifests(options.storageRoot).every((run) => !existsSync(run.workspacePayload))).toBe(
			true,
		);
	});
	it("cleans a failing worker and catches fast writes at the final budget check", async () => {
		const options = fixture();
		expect(
			await superviseQualification(worker(options.checkout, "process.exit(7)"), [], options),
		).toBe(7);
		const small = { ...options, policy: { ...policy, warnBytes: 100, runBytes: 500 } };
		expect(await superviseQualification(worker(options.checkout), [], small)).toBe(1);
		expect(
			manifests(options.storageRoot)
				.map((run) => run.status)
				.sort((left, right) => left.localeCompare(right)),
		).toEqual(["budget-exceeded", "failed"]);
		expect(
			manifests(options.storageRoot).every(
				(run) => !(existsSync(run.payload) || existsSync(run.workspacePayload)),
			),
		).toBe(true);
	});
	it("stops a running worker when disk use grows", async () => {
		const options = fixture();
		const path = worker(
			options.checkout,
			"writeFileSync(join(process.env.SKELETON_QUALIFICATION_STORAGE!, 'large'), Buffer.alloc(20000)); setInterval(() => {}, 1000);",
		);
		expect(await superviseQualification(path, [], options)).toBe(1);
		expect(manifests(options.storageRoot)[0].status).toBe("budget-exceeded");
		expect(existsSync(manifests(options.storageRoot)[0].payload)).toBe(false);
	});
	it("samples safely while the worker creates and removes temporary files", async () => {
		const options = {
			...fixture(),
			policy: {
				...policy,
				warnBytes: 1024 ** 2,
				runBytes: 2 * 1024 ** 2,
				totalBytes: 4 * 1024 ** 2,
			},
		};
		const entry = worker(
			options.checkout,
			`
   const { mkdirSync, rmSync } = await import('node:fs');
   const changing = join(process.env.SKELETON_QUALIFICATION_STORAGE!, 'changing');
   const end = Date.now() + 500;
   while (Date.now() < end) {
    mkdirSync(changing, { recursive: true });
    for (let i = 0; i < 100; i++) writeFileSync(join(changing, String(i)), 'temporary');
    rmSync(changing, { recursive: true, force: true });
   }
  `,
		);
		expect(await superviseQualification(entry, [], options)).toBe(0);
	});
	it("handles cancellation and removes the owned payload", async () => {
		const options = fixture();
		const execution = superviseQualification(
			worker(options.checkout, "setInterval(() => {}, 1000)"),
			[],
			options,
		);
		await until(() => manifests(options.storageRoot)[0]?.child !== undefined);
		process.emit("SIGTERM");
		expect(await execution).toBe(1);
		expect(manifests(options.storageRoot)[0].status).toBe("cancelled");
		expect(existsSync(manifests(options.storageRoot)[0].payload)).toBe(false);
	});
	it("recovers a forced-killed supervisor only after its worker stops", async () => {
		const options = fixture();
		const entry = worker(options.checkout, "setInterval(() => {}, 1000)");
		const driver = join(options.checkout, "driver.ts");
		const module = resolve("scripts/efficacy/qualification-storage.ts");
		writeFileSync(
			driver,
			`import { superviseQualification } from ${JSON.stringify(module)}; await superviseQualification(${JSON.stringify(entry)}, [], ${JSON.stringify(options)});`,
		);
		const supervisor = spawn(process.execPath, [driver], { stdio: "ignore" });
		try {
			await until(
				() =>
					existsSync(options.storageRoot) && manifests(options.storageRoot)[0]?.child !== undefined,
			);
			const run = manifests(options.storageRoot)[0];
			const exited = new Promise((done) => supervisor.once("exit", done));
			supervisor.kill("SIGKILL");
			await exited;
			recoverStorage(options.storageRoot, Date.now() + 1000);
			expect(existsSync(run.payload)).toBe(true);
			process.kill(-run.child!.pid, "SIGKILL");
			await until(() => !groupActive(run.child!.pid));
			recoverStorage(options.storageRoot, Date.now() + 1000);
			expect(existsSync(run.payload)).toBe(false);
			expect(manifests(options.storageRoot)[0].status).toBe("interrupted");
		} finally {
			supervisor.kill("SIGKILL");
			for (const run of manifests(options.storageRoot)) {
				if (run.child && groupActive(run.child.pid)) process.kill(-run.child.pid, "SIGKILL");
			}
		}
	});
	it("protects live owners, unrelated roots, symlinks and malformed manifests", () => {
		const options = fixture();
		mkdirSync(options.storageRoot);
		const id = randomUUID();
		const runRoot = join(options.storageRoot, id);
		mkdirSync(runRoot);
		const payload = join(runRoot, "payload");
		mkdirSync(payload);
		const manifest: StorageManifest = {
			version: 1,
			kind: "skeleton-qualification-storage",
			id,
			payload,
			workspacePayload: join(options.checkout, ".qualification-cache", "storage-workspaces", id),
			checkout: options.checkout,
			owner: processIdentity(),
			status: "running",
			bytes: 0,
			peakBytes: 0,
			policy,
			createdAt: new Date().toISOString(),
			expiresAt: new Date(0).toISOString(),
		};
		writeFileSync(join(runRoot, "owner.json"), JSON.stringify(manifest));
		recoverStorage(options.storageRoot);
		expect(existsSync(payload)).toBe(true);
		expect(ownerActive({ ...processIdentity(), started: "different start identity" })).toBe(false);
		rmSync(payload, { recursive: true });
		symlinkSync(options.checkout, payload);
		manifest.owner.pid = 2147483647;
		writeFileSync(join(runRoot, "owner.json"), JSON.stringify(manifest));
		expect(() => recoverStorage(options.storageRoot)).toThrow("symlink");
		expect(existsSync(options.checkout)).toBe(true);
		expect(treeBytes(payload)).toBe(0);
		writeFileSync(join(runRoot, "owner.json"), "{}");
		expect(() => recoverStorage(options.storageRoot)).not.toThrow();
	});
});
