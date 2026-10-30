import { dirname, posix } from "node:path";
import { codeSnippets } from "./markdown.ts";
import { type FileSource, readRepoText } from "./repo-files.ts";

/**
 * Package-manager commands in docs are references to `package.json#scripts.<name>` that name
 * no file: the manager in `packageManager` is the prefix, the nearest package.json the owner.
 */
type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface PackageJson {
	packageManager?: unknown;
	engines?: { node?: unknown };
	scripts?: Record<string, unknown>;
}

interface ScriptReference {
	script: string;
	command: string;
	line: number;
}

interface ToolchainFact {
	field: "packageManager" | "engines.node";
	value: string;
}

/**
 * Bare `<pm> <name>` words each manager runs itself instead of a script. npm runs a script
 * bare only for its lifecycle shorthands; pnpm, yarn and bun run any other name as a script.
 */
const OWN_COMMANDS: Record<Exclude<PackageManager, "npm">, Set<string>> = {
	pnpm: new Set(
		"add approve-builds audit bin config create dedupe deploy dlx env exec fetch i import init install install-test it licenses link list ln ls outdated pack patch patch-commit prune publish rb rebuild remove rm root self-update server setup store un uninstall unlink up update why".split(
			" ",
		),
	),
	yarn: new Set(
		"add audit autoclean bin cache check config constraints create dedupe dlx exec explain generate-lock-entry global help import info init install link licenses list login logout node npm outdated owner pack patch plugin policy publish rebuild remove search set stage tag team unlink unplug up upgrade version why workspace workspaces".split(
			" ",
		),
	),
	bun: new Set(
		"a add audit build c create exec i info init install link outdated patch pm publish r remove repl rm test un unlink update upgrade why x".split(
			" ",
		),
	),
};
const NPM_SCRIPT_SHORTHANDS = new Set(["test", "stop", "restart"]);
const RUN_WORDS = new Set(["run", "run-script"]);
/** Flags that point the command at another workspace package, whose scripts live elsewhere. */
const WORKSPACE_FLAGS =
	/^(--filter|-F|-C|--dir|--cwd|-w|--workspace|--workspace-root|-r|--recursive|workspace)(=|$)/;
const SHELL_FENCES = new Set(["bash", "sh", "shell", "zsh", "console", "terminal"]);
const SCRIPT_NAME_RE = /^[\w@][\w:@.-]*$/;
const FILE_LIKE_RE = /\/|\.(?:[cm]?[jt]sx?|json|sh)$/;

export function packageManagerOf(pkg: PackageJson): PackageManager | null {
	const name = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
	return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : null;
}

function isCheckedSnippet(snippet: { fenced: boolean; lang: string | null }): boolean {
	return !snippet.fenced || snippet.lang === null || SHELL_FENCES.has(snippet.lang.toLowerCase());
}

/** Shell words of each command in a line: split on `&&`, `||`, `;`, `|`; drop `$ ` and `VAR=x`. */
function commandsOf(line: string): string[][] {
	return line.split(/&&|\|\||;|\|/).map((segment) => {
		const words = segment
			.trim()
			.replace(/^\$\s+/, "")
			.split(/\s+/)
			.filter(Boolean);
		while (words[0]?.includes("=")) words.shift();
		return words;
	});
}

function isScriptName(name: string | undefined): name is string {
	return name !== undefined && SCRIPT_NAME_RE.test(name) && !FILE_LIKE_RE.test(name);
}

/** Whether a bare `<pm> <name>` runs the script rather than one of the manager's own commands. */
function runsBareScript(pm: PackageManager, name: string): boolean {
	return pm === "npm" ? NPM_SCRIPT_SHORTHANDS.has(name) : !OWN_COMMANDS[pm].has(name);
}

/** The script a manager command runs, or null when it runs something else. */
function scriptOf(pm: PackageManager, words: string[]): string | null {
	if (words[0] !== pm) return null;
	const args = words.slice(1);
	if (args.some((arg) => WORKSPACE_FLAGS.test(arg))) return null;
	const [first, ...rest] = args.filter((arg) => !arg.startsWith("-"));
	if (first === undefined) return null;
	if (RUN_WORDS.has(first)) return isScriptName(rest[0]) ? rest[0] : null;
	return isScriptName(first) && runsBareScript(pm, first) ? first : null;
}

/** `<pm> run <name>` and `<pm> <name>` in inline code and shell fences. */
export function scriptReferences(markdown: string, pm: PackageManager): ScriptReference[] {
	const references: ScriptReference[] = [];
	for (const snippet of codeSnippets(markdown).filter(isCheckedSnippet)) {
		snippet.value.split("\n").forEach((line, offset) => {
			for (const words of commandsOf(line)) {
				const script = scriptOf(pm, words);
				if (script === null) continue;
				references.push({ script, command: words.join(" "), line: snippet.line + offset });
			}
		});
	}
	return references;
}

/** Exact toolchain values the instruction file beside this package.json must quote. */
export function toolchainFacts(pkg: PackageJson): ToolchainFact[] {
	const facts: ToolchainFact[] = [];
	if (typeof pkg.packageManager === "string") {
		facts.push({ field: "packageManager", value: pkg.packageManager });
	}
	if (typeof pkg.engines?.node === "string") {
		facts.push({ field: "engines.node", value: pkg.engines.node });
	}
	return facts;
}

/** True when an inline code span in the document is exactly this value. */
export function quotesValue(markdown: string, value: string): boolean {
	return codeSnippets(markdown).some(
		(snippet) => !snippet.fenced && snippet.value.trim() === value,
	);
}

export function parsePackageJson(content: string | null): PackageJson | null {
	if (content === null) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as PackageJson)
			: null;
	} catch {
		return null;
	}
}

/** Repo-relative path of the package.json nearest the document, or null when none owns it. */
export function owningPackageJson(
	root: string,
	docPath: string,
	source: FileSource = "worktree",
): string | null {
	let dir = dirname(docPath);
	for (;;) {
		const candidate = dir === "." ? "package.json" : posix.join(dir, "package.json");
		if (readRepoText(root, candidate, source) !== null) return candidate;
		if (dir === "." || dir === "") return null;
		dir = dirname(dir);
	}
}
