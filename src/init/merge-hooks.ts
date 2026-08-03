import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveTemplatesDir } from "./package-paths.ts";
import { isSkeletonHookCommand } from "./resolve-hook-command.ts";

const TEMPLATES_DIR = resolveTemplatesDir();

export type MergeAction = "added" | "updated" | "skipped" | "conflict";

export interface MergeHookResult {
	platform: string;
	action: MergeAction;
	message?: string;
}

export interface MergeHooksOptions {
	cwd: string;
	hookCommand: string;
	forceHooks?: boolean;
}

function identityKey(platform: string, event: string, matcher: string): string {
	return `skeleton:customize:${platform}:${event}:${matcher}`;
}

function loadFragment(name: string, hookCommand: string): unknown {
	const raw = readFileSync(join(TEMPLATES_DIR, name), "utf8");
	return JSON.parse(raw.replaceAll("{{HOOK_COMMAND}}", hookCommand));
}

function readJson(path: string): unknown {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON in ${path}: ${error}`);
	}
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

interface CursorHookEntry {
	command?: string;
	matcher?: string;
	[key: string]: unknown;
}

interface MergeExistingCursorInput {
	postToolUse: CursorHookEntry[];
	skeletonIdx: number;
	canonical: CursorHookEntry;
	opts: MergeHooksOptions;
}

function mergeExistingCursorHook(input: MergeExistingCursorInput): MergeHookResult | null {
	const { postToolUse, skeletonIdx, canonical, opts } = input;
	const current = postToolUse[skeletonIdx];
	const userEdited =
		current &&
		!opts.forceHooks &&
		(current.matcher !== canonical.matcher || !isSkeletonHookCommand(current.command));

	if (userEdited) {
		return {
			platform: "cursor",
			action: "conflict",
			message: identityKey("cursor", "postToolUse", String(current.matcher ?? "Read")),
		};
	}

	const extras = Object.fromEntries(
		Object.entries(current ?? {}).filter(([key]) => !["command", "matcher"].includes(key)),
	);
	const merged = { ...extras, ...canonical };
	if (deepEqual(current, merged)) return { platform: "cursor", action: "skipped" };
	postToolUse[skeletonIdx] = merged;
	return null;
}

interface PersistCursorHooksInput {
	targetPath: string;
	existing: Record<string, unknown>;
	hooks: Record<string, CursorHookEntry[]>;
	postToolUse: CursorHookEntry[];
	skeletonIdx: number;
}

function persistCursorHooks(input: PersistCursorHooksInput): MergeHookResult {
	const { targetPath, existing, hooks, postToolUse, skeletonIdx } = input;
	const next = {
		...existing,
		version: existing.version ?? 1,
		hooks: { ...hooks, postToolUse },
	};
	if (deepEqual(existing, next)) return { platform: "cursor", action: "skipped" };
	writeJson(targetPath, next);
	return { platform: "cursor", action: skeletonIdx >= 0 ? "updated" : "added" };
}

function mergeCursorHooks(
	targetPath: string,
	fragment: { hooks?: { postToolUse?: CursorHookEntry[] } },
	opts: MergeHooksOptions,
): MergeHookResult {
	const existing = (readJson(targetPath) as Record<string, unknown> | null) ?? {};
	const hooks = (existing.hooks as Record<string, CursorHookEntry[]> | undefined) ?? {};
	const postToolUse = [...(hooks.postToolUse ?? [])];
	const incoming = fragment.hooks?.postToolUse?.[0];
	if (!incoming) return { platform: "cursor", action: "skipped" };

	const skeletonIdx = postToolUse.findIndex((entry) => isSkeletonHookCommand(entry.command));
	const canonical = { ...incoming, matcher: incoming.matcher ?? "Read" };

	if (skeletonIdx >= 0) {
		const conflict = mergeExistingCursorHook({ postToolUse, skeletonIdx, canonical, opts });
		if (conflict) return conflict;
	} else {
		postToolUse.push(canonical);
	}

	return persistCursorHooks({ targetPath, existing, hooks, postToolUse, skeletonIdx });
}

interface NestedHookEntry {
	type?: string;
	command?: string;
	[key: string]: unknown;
}

interface MatcherGroup {
	matcher?: string;
	hooks?: NestedHookEntry[];
	[key: string]: unknown;
}

interface MergeNestedHooksOptions {
	platform: string;
	targetPath: string;
	fragment: { hooks?: Record<string, MatcherGroup[]> };
	eventName: string;
	opts: MergeHooksOptions;
}

interface MergeIncomingHookGroupOptions {
	group: MatcherGroup;
	incomingHook: NestedHookEntry;
	eventHooks: MatcherGroup[];
	opts: MergeHooksOptions;
	platform: string;
	eventName: string;
}

interface MergeExistingNestedInput {
	hooks: NestedHookEntry[];
	skeletonIdx: number;
	incomingHook: NestedHookEntry;
	opts: MergeHooksOptions;
	platform: string;
	eventName: string;
	matcher: string;
}

function mergeExistingNestedSkeletonHook(input: MergeExistingNestedInput): {
	changed: boolean;
	conflict?: MergeHookResult;
} {
	const { hooks, skeletonIdx, incomingHook, opts, platform, eventName, matcher } = input;
	const current = hooks[skeletonIdx];
	const userEdited =
		current &&
		!opts.forceHooks &&
		(current.type !== incomingHook.type || !isSkeletonHookCommand(current.command));

	if (userEdited) {
		return {
			changed: false,
			conflict: {
				platform,
				action: "conflict",
				message: identityKey(platform, eventName, matcher),
			},
		};
	}

	const extras = Object.fromEntries(
		Object.entries(current ?? {}).filter(([key]) => !["type", "command"].includes(key)),
	);
	const merged = { ...extras, ...incomingHook };
	if (!deepEqual(current, merged)) {
		hooks[skeletonIdx] = merged;
		return { changed: true };
	}
	return { changed: false };
}

function mergeIncomingHookGroup(args: MergeIncomingHookGroupOptions): {
	changed: boolean;
	conflict?: MergeHookResult;
} {
	const { group, incomingHook, eventHooks, opts, platform, eventName } = args;
	const matcher = group.matcher ?? "";
	const groupIdx = eventHooks.findIndex((g) => g.matcher === matcher);
	if (groupIdx < 0) {
		eventHooks.push({ ...group, hooks: [{ ...incomingHook }] });
		return { changed: true };
	}

	const existingGroup = eventHooks[groupIdx];
	const hooks = [...(existingGroup?.hooks ?? [])];
	const skeletonIdx = hooks.findIndex((entry) => isSkeletonHookCommand(entry.command));

	if (skeletonIdx >= 0) {
		const result = mergeExistingNestedSkeletonHook({
			hooks,
			skeletonIdx,
			incomingHook,
			opts,
			platform,
			eventName,
			matcher,
		});
		if (result.conflict) return { changed: false, conflict: result.conflict };
		eventHooks[groupIdx] = { ...existingGroup, matcher, hooks };
		return { changed: result.changed };
	}

	hooks.push({ ...incomingHook });
	eventHooks[groupIdx] = { ...existingGroup, matcher, hooks };
	return { changed: true };
}

function mergeIncomingGroups(args: {
	incomingGroups: MatcherGroup[];
	eventHooks: MatcherGroup[];
	opts: MergeHooksOptions;
	platform: string;
	eventName: string;
}): { changed: boolean; conflict?: MergeHookResult } {
	let changed = false;
	for (const incomingGroup of args.incomingGroups) {
		const incomingHook = incomingGroup.hooks?.[0];
		if (!incomingHook) continue;

		const result = mergeIncomingHookGroup({
			group: incomingGroup,
			incomingHook,
			eventHooks: args.eventHooks,
			opts: args.opts,
			platform: args.platform,
			eventName: args.eventName,
		});
		if (result.conflict) return { changed: false, conflict: result.conflict };
		if (result.changed) changed = true;
	}
	return { changed };
}

function mergeNestedHooks(args: MergeNestedHooksOptions): MergeHookResult {
	const { platform, targetPath, eventName } = args;
	const existing = (readJson(targetPath) as Record<string, unknown> | null) ?? {};
	const rootHooks = (existing.hooks as Record<string, MatcherGroup[]> | undefined) ?? {};
	const eventHooks = [...(rootHooks[eventName] ?? [])];
	const incomingGroups = args.fragment.hooks?.[eventName] ?? [];

	const result = mergeIncomingGroups({
		incomingGroups,
		eventHooks,
		opts: args.opts,
		platform,
		eventName,
	});
	if (result.conflict) return result.conflict;
	if (!result.changed) return { platform, action: "skipped" };

	const next = {
		...existing,
		hooks: { ...rootHooks, [eventName]: eventHooks },
	};
	writeJson(targetPath, next);
	return { platform, action: "updated" };
}

export function mergeHookConfigs(opts: MergeHooksOptions): MergeHookResult[] {
	const results: MergeHookResult[] = [];

	const cursorPath = join(opts.cwd, ".cursor/hooks.json");
	const cursorFragment = loadFragment("cursor-hooks.fragment.json", opts.hookCommand) as {
		hooks?: { postToolUse?: CursorHookEntry[] };
	};
	results.push(mergeCursorHooks(cursorPath, cursorFragment, opts));

	const claudePath = join(opts.cwd, ".claude/settings.json");
	const claudeFragment = loadFragment("claude-settings.fragment.json", opts.hookCommand) as {
		hooks?: Record<string, MatcherGroup[]>;
	};
	results.push(
		mergeNestedHooks({
			platform: "claude",
			targetPath: claudePath,
			fragment: claudeFragment,
			eventName: "PostToolUse",
			opts,
		}),
	);

	const codexPath = join(opts.cwd, ".codex/hooks.json");
	if (existsSync(join(opts.cwd, ".codex"))) {
		const codexFragment = loadFragment("codex-hooks.fragment.json", opts.hookCommand) as {
			hooks?: Record<string, MatcherGroup[]>;
		};
		results.push(
			mergeNestedHooks({
				platform: "codex",
				targetPath: codexPath,
				fragment: codexFragment,
				eventName: "PostToolUse",
				opts,
			}),
		);
	} else {
		results.push({ platform: "codex", action: "skipped", message: "missing .codex directory" });
	}

	return results;
}

export function mergePackageJsonScripts(cwd: string): MergeAction {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return "skipped";

	const fragment = JSON.parse(
		readFileSync(join(TEMPLATES_DIR, "package.json.scripts.fragment.json"), "utf8"),
	) as Record<string, string>;
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
		scripts?: Record<string, string>;
	};
	pkg.scripts ??= {};

	let changed = false;
	for (const [key, value] of Object.entries(fragment)) {
		if (pkg.scripts[key] !== value) {
			pkg.scripts[key] = value;
			changed = true;
		}
	}

	if (!changed) return "skipped";
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
	return "updated";
}
