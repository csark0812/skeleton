import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SKELETON_AGENT_GUIDE } from "../src/init/init.ts";
import { parseQualificationCorpus } from "./efficacy/corpus.ts";
import { expoPilotV2Paths } from "./efficacy/pilot-paths.ts";
import {
	assertPairedAgentWorkspaces,
	prepareAgentWorkspace,
	publicWorkspacePaths,
} from "./efficacy/public-workspaces.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const corpus = parseQualificationCorpus(
	JSON.parse(
		readFileSync(join(root, "agent-suites/broader-openai-v1/qualification-corpus.json"), "utf8"),
	),
);
const task = corpus.tasks.find((entry) => entry.id === "expo-metro-ownership");
if (!task) throw new Error("Retired Expo regression task is missing.");
const paths = expoPilotV2Paths(root);
if (existsSync(paths.result))
	throw new Error("Pilot v2 already ran; do not replace its prepared snapshot.");

const sources = publicWorkspacePaths(root, task);
for (const path of Object.values(sources))
	if (!existsSync(path)) throw new Error(`Missing frozen Expo source workspace: ${path}`);
prepareAgentWorkspace(sources.control, paths.control);
prepareAgentWorkspace(sources.treatment, paths.treatment);

const packDestination = join(root, ".qualification-cache", "pilot-artifact-v2");
rmSync(packDestination, { recursive: true, force: true });
mkdirSync(packDestination, { recursive: true });
const packed = JSON.parse(
	execFileSync(
		"npm",
		["pack", "--ignore-scripts", "--json", "--pack-destination", packDestination],
		{
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, npm_config_cache: join(root, ".qualification-cache", "npm") },
		},
	),
)[0];
const tarball = join(packDestination, packed.filename);

// Keep Expo's large dependency caches read-only and give both arms the same link layout.
function linkExecutables(cachedDependencies: string, nodeModules: string) {
	const localBin = join(nodeModules, ".bin");
	mkdirSync(localBin);
	for (const executable of readdirSync(join(cachedDependencies, ".bin"))) {
		if (executable === "skeleton") continue;
		symlinkSync(
			realpathSync(join(cachedDependencies, ".bin", executable)),
			join(localBin, executable),
		);
	}
}

function overlayDependencies(workspace: string) {
	const nodeModules = join(workspace, "node_modules");
	const cachedDependencies = realpathSync(nodeModules);
	rmSync(nodeModules);
	mkdirSync(nodeModules);
	for (const entry of readdirSync(cachedDependencies)) {
		if (entry === "@csark0812") continue;
		if (entry === ".bin") {
			linkExecutables(cachedDependencies, nodeModules);
			continue;
		}
		symlinkSync(join(cachedDependencies, entry), join(nodeModules, entry));
	}
	return nodeModules;
}
overlayDependencies(paths.control);
const nodeModules = overlayDependencies(paths.treatment);
const installedPackage = join(nodeModules, "@csark0812", "skeleton");
mkdirSync(installedPackage, { recursive: true });
execFileSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", installedPackage]);
symlinkSync("../@csark0812/skeleton/dist/cli.js", join(nodeModules, ".bin", "skeleton"));

const guidePath = join(paths.treatment, "AGENTS.md");
const existing = readFileSync(guidePath, "utf8");
const marker = "<!-- skeleton: context-guide -->";
const markerOffset = existing.indexOf(marker);
if (markerOffset < 0 || existing.indexOf(marker, markerOffset + marker.length) >= 0)
	throw new Error("Expected exactly one generated Skeleton context guide.");
writeFileSync(guidePath, `${existing.slice(0, markerOffset).trimEnd()}${SKELETON_AGENT_GUIDE}`);
assertPairedAgentWorkspaces(paths, task);

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const candidateHash = sha256(join(root, "dist/cli.js"));
const installedHash = sha256(join(installedPackage, "dist/cli.js"));
if (candidateHash !== installedHash)
	throw new Error("Packed pilot CLI differs from current build.");
console.log(`Prepared one unrun Expo development pair with current packed CLI ${installedHash}.`);
