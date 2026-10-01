import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const GiB = 1024 ** 3;
export const STORAGE_ENV = "SKELETON_QUALIFICATION_STORAGE";
export const WORKSPACES_ENV = "SKELETON_QUALIFICATION_WORKSPACES";
export const EVIDENCE_ENV = "SKELETON_QUALIFICATION_EVIDENCE";
export interface StoragePolicy {
	warnBytes: number;
	runBytes: number;
	totalBytes: number;
	minFreeBytes: number;
	recoveryAgeMs: number;
	pollMs: number;
}
export function storagePolicy(env = process.env): StoragePolicy {
	const number = (name: string, fallback: number) => {
		const value = env[name] === undefined ? fallback : Number(env[name]);
		if (!Number.isFinite(value) || value < 0)
			throw new Error(`${name} must be a finite nonnegative number.`);
		return value;
	};
	const policy = {
		warnBytes: number("SKELETON_STORAGE_WARN_GIB", 10) * GiB,
		runBytes: number("SKELETON_STORAGE_RUN_GIB", 25) * GiB,
		totalBytes: number("SKELETON_STORAGE_TOTAL_GIB", 50) * GiB,
		minFreeBytes: number("SKELETON_STORAGE_MIN_FREE_GIB", 100) * GiB,
		recoveryAgeMs: number("SKELETON_STORAGE_RECOVERY_HOURS", 24) * 3600000,
		pollMs: number("SKELETON_STORAGE_POLL_MS", 2000),
	};
	if (
		policy.pollMs < 100 ||
		policy.warnBytes > policy.runBytes ||
		policy.runBytes > policy.totalBytes
	)
		throw new Error("Storage limits require warn <= run <= total and poll >= 100ms.");
	return policy;
}
interface Owner {
	pid: number;
	started: string | null;
}
export function processIdentity(pid = process.pid): Owner {
	try {
		return {
			pid,
			started:
				execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim() ||
				null,
		};
	} catch {
		return { pid, started: null };
	}
}
export function groupActive(pid: number) {
	try {
		process.kill(-pid, 0);
		const groups = execFileSync("ps", ["-axo", "pgid=,stat="], { encoding: "utf8" });
		return groups.split("\n").some((line) => {
			const [group, status] = line.trim().split(/\s+/);
			return Number(group) === pid && !status?.startsWith("Z");
		});
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}
export function ownerActive(owner: Owner) {
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
	try {
		if (
			execFileSync("ps", ["-p", String(owner.pid), "-o", "stat="], { encoding: "utf8" })
				.trim()
				.startsWith("Z")
		)
			return false;
	} catch {
		return true;
	}
	const current = processIdentity(owner.pid);
	return !(owner.started && current.started) || current.started === owner.started;
}
export interface StorageManifest {
	version: 1;
	kind: "skeleton-qualification-storage";
	id: string;
	checkout: string;
	createdAt: string;
	expiresAt: string;
	owner: Owner;
	child?: Owner;
	status: "running" | "succeeded" | "failed" | "cancelled" | "budget-exceeded" | "interrupted";
	payload: string;
	workspacePayload: string;
	bytes: number;
	peakBytes: number;
	policy: StoragePolicy;
	reason?: string;
	cleanedAt?: string;
	workerExitCode?: number;
}
export function treeBytes(path: string): number {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) return 0;
		if (!stat.isDirectory()) return stat.size;
		return readdirSync(path).reduce((sum, name) => sum + treeBytes(join(path, name)), 0);
	} catch (error) {
		// Build tools rename and unlink transient files while the supervisor samples.
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return 0;
		throw error;
	}
}

function plainDirectory(path: string) {
	if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
		throw new Error(`Storage directory must not be a symlink: ${path}`);
	if (dirname(path) !== path) plainDirectory(dirname(path));
}
function save(path: string, manifest: StorageManifest) {
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
	renameSync(temporary, path);
}
function validManifest(path: string): StorageManifest | undefined {
	try {
		const value = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as StorageManifest;
		if (
			value.version !== 1 ||
			value.kind !== "skeleton-qualification-storage" ||
			value.id !== path.split("/").at(-1)
		)
			return;
		if (!/^[0-9a-f-]{36}$/.test(value.id) || value.payload !== join(path, "payload")) return;
		if (
			!Number.isInteger(value.owner?.pid) ||
			value.owner.pid <= 0 ||
			!Number.isFinite(Date.parse(value.expiresAt))
		)
			return;
		if (value.child && (!Number.isInteger(value.child.pid) || value.child.pid <= 0)) return;
		plainDirectory(path);
		return value;
	} catch {}
}
function removePayload(manifest: StorageManifest) {
	// Every ancestor is checked. A substituted symlink never becomes a deletion target.
	for (const path of [manifest.payload, manifest.workspacePayload]) {
		if (existsSync(path)) {
			plainDirectory(path);
			rmSync(path, { recursive: true, force: true });
		}
	}
	manifest.cleanedAt = new Date().toISOString();
}
export function recoverStorage(storageRoot: string, now = Date.now()) {
	mkdirSync(storageRoot, { recursive: true });
	plainDirectory(resolve(storageRoot));
	for (const name of readdirSync(storageRoot)) {
		const path = join(storageRoot, name);
		const manifest = validManifest(path);
		if (!manifest || manifest.cleanedAt || now < Date.parse(manifest.expiresAt)) continue;
		if (
			ownerActive(manifest.owner) ||
			(manifest.child && (ownerActive(manifest.child) || groupActive(manifest.child.pid)))
		)
			continue;
		manifest.status = "interrupted";
		removePayload(manifest);
		save(join(path, "owner.json"), manifest);
	}
}
export function assertStorageBudget(
	{ bytes, total, free }: { bytes: number; total: number; free: number },
	policy: StoragePolicy,
) {
	if (bytes > policy.runBytes || total > policy.totalBytes || free < policy.minFreeBytes)
		throw new Error(
			`Qualification storage budget exceeded: run=${bytes}, total=${total}, free=${free} bytes; limits run=${policy.runBytes}, total=${policy.totalBytes}, minimum free=${policy.minFreeBytes}.`,
		);
}
export function qualificationCacheRoot(checkout: string) {
	return process.env[STORAGE_ENV] ?? join(checkout, ".qualification-cache");
}

interface StorageRun {
	storageRoot: string;
	durable: string;
	manifest: StorageManifest;
	warned: boolean;
}
type SupervisorOptions = { checkout?: string; storageRoot?: string; policy?: StoragePolicy };
function allocateRun(entry: string, options: SupervisorOptions): StorageRun {
	const checkout = realpathSync(resolve(options.checkout ?? dirname(dirname(entry))));
	const requestedRoot = resolve(
		options.storageRoot ?? join(tmpdir(), "skeleton-qualification-storage-v1"),
	);
	mkdirSync(requestedRoot, { recursive: true });
	const storageRoot = realpathSync(requestedRoot);
	if (statSync(checkout).dev !== statSync(storageRoot).dev)
		throw new Error("Qualification storage and checkout must be on the same filesystem.");
	const policy = options.policy ?? storagePolicy();
	recoverStorage(storageRoot);
	const id = randomUUID();
	const runRoot = join(storageRoot, id);
	mkdirSync(runRoot);
	const manifest: StorageManifest = {
		version: 1,
		kind: "skeleton-qualification-storage",
		id,
		checkout,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + policy.recoveryAgeMs).toISOString(),
		owner: processIdentity(),
		status: "running",
		payload: join(runRoot, "payload"),
		workspacePayload: join(checkout, ".qualification-cache", "storage-workspaces", id),
		bytes: 0,
		peakBytes: 0,
		policy,
	};
	const durable = join(checkout, ".qualification-cache", "storage-evidence", id, "owner.json");
	mkdirSync(dirname(durable), { recursive: true });
	const run = { storageRoot, durable, manifest, warned: false };
	persistRun(run);
	return run;
}
function persistRun(run: StorageRun) {
	save(join(dirname(run.manifest.payload), "owner.json"), run.manifest);
	save(run.durable, run.manifest);
}
function checkRun(run: StorageRun) {
	const { storageRoot, manifest } = run;
	const snapshots = treeBytes(join(manifest.checkout, ".agent-test"));
	manifest.bytes = treeBytes(manifest.payload) + treeBytes(manifest.workspacePayload) + snapshots;
	manifest.peakBytes = Math.max(manifest.peakBytes, manifest.bytes);
	const total =
		readdirSync(storageRoot).reduce((sum, name) => {
			const path = join(storageRoot, name);
			const registered = validManifest(path);
			return (
				sum +
				treeBytes(join(path, "payload")) +
				(registered ? treeBytes(registered.workspacePayload) : 0)
			);
		}, 0) + snapshots;
	const disk = statfsSync(storageRoot);
	assertStorageBudget(
		{ bytes: manifest.bytes, total, free: disk.bavail * disk.bsize },
		manifest.policy,
	);
	if (!run.warned && manifest.bytes > manifest.policy.warnBytes) {
		run.warned = true;
		console.warn(
			`Qualification storage warning: ${manifest.bytes} bytes. Manifest: ${run.durable}`,
		);
	}
	persistRun(run);
}
function recordFailure(run: StorageRun, status: StorageManifest["status"], error: unknown) {
	run.manifest.status = status;
	run.manifest.reason = String(error);
	persistRun(run);
}
function signalGroup(pid: number | undefined, signal: NodeJS.Signals) {
	if (!pid) return;
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}
async function finishRun(run: StorageRun) {
	const pid = run.manifest.child?.pid;
	signalGroup(pid, "SIGKILL");
	const deadline = Date.now() + 3000;
	while (pid && groupActive(pid) && Date.now() < deadline)
		await new Promise((done) => setTimeout(done, 50));
	run.manifest.bytes = treeBytes(run.manifest.payload) + treeBytes(run.manifest.workspacePayload);
	if (!(pid && groupActive(pid))) removePayload(run.manifest);
	else
		run.manifest.reason = `${run.manifest.reason ?? ""} Process group remains; payload protected for recovery.`;
	persistRun(run);
	console.log(`Qualification storage manifest: ${run.durable}`);
}
export function assertQualificationStorage() {
	const payload = process.env[STORAGE_ENV];
	const manifest = payload ? validManifest(dirname(payload)) : undefined;
	if (
		!manifest ||
		manifest.payload !== payload ||
		manifest.workspacePayload !== process.env[WORKSPACES_ENV] ||
		!ownerActive(manifest.owner)
	)
		throw new Error("Qualification preparation and execution require the supervised launcher.");
}
/** Supervise synchronous preparation and its whole subprocess group from another process. */
export async function superviseQualification(
	entry: string,
	args: string[],
	options: SupervisorOptions = {},
) {
	if (process.platform === "win32")
		throw new Error("Qualification storage supervision requires POSIX process groups.");
	const run = allocateRun(entry, options);
	try {
		checkRun(run);
	} catch (error) {
		recordFailure(run, "budget-exceeded", error);
		await finishRun(run);
		throw error;
	}
	try {
		const child = startWorker(run, entry, args);
		return await monitorWorker(run, child);
	} catch (error) {
		recordFailure(run, "failed", error);
		throw error;
	} finally {
		await finishRun(run);
	}
}
function startWorker(run: StorageRun, entry: string, args: string[]) {
	const payload = run.manifest.payload;
	mkdirSync(join(payload, "tmp"), { recursive: true });
	mkdirSync(run.manifest.workspacePayload, { recursive: true });
	plainDirectory(run.manifest.workspacePayload);
	const worker = fileURLToPath(new URL("./qualification-worker.ts", import.meta.url));
	const child = spawn(process.execPath, [worker, entry, ...args], {
		cwd: run.manifest.checkout,
		stdio: "inherit",
		detached: true,
		env: {
			...process.env,
			[STORAGE_ENV]: payload,
			[WORKSPACES_ENV]: run.manifest.workspacePayload,
			[EVIDENCE_ENV]: dirname(run.durable),
			TMPDIR: join(payload, "tmp"),
			TMP: join(payload, "tmp"),
			TEMP: join(payload, "tmp"),
		},
	});
	if (child.pid) run.manifest.child = processIdentity(child.pid);
	persistRun(run);
	return child;
}

async function monitorWorker(run: StorageRun, child: ReturnType<typeof spawn>) {
	let escalation: ReturnType<typeof setTimeout> | undefined;
	let stopping = false;
	const stop = (status: StorageManifest["status"], reason: unknown) => {
		if (stopping) return;
		stopping = true;
		recordFailure(run, status, reason);
		signalGroup(child.pid, "SIGTERM");
		escalation = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 3000);
	};
	const interrupt = () => stop("cancelled", "Supervisor received an interruption signal.");
	const check = () => {
		try {
			checkRun(run);
		} catch (error) {
			stop("budget-exceeded", error);
		}
	};
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", interrupt);
	const timer = setInterval(check, run.manifest.policy.pollMs);
	try {
		const code = await new Promise<number>((fulfill, reject) => {
			child.once("error", reject);
			child.once("exit", (code) => fulfill(code ?? 1));
		});
		run.manifest.workerExitCode = code;
		if (!stopping) {
			check();
			if (!stopping) run.manifest.status = code === 0 ? "succeeded" : "failed";
		}
		return stopping ? 1 : code;
	} finally {
		clearInterval(timer);
		if (escalation) clearTimeout(escalation);
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", interrupt);
	}
}
