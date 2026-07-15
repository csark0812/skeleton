import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { findRepoRoot, loadConfig } from "./audit/config/load.ts";
import { collectScanFiles } from "./audit/core/collect.ts";
import {
	matchesGlobScope,
	normalizeRelPath,
	REGISTRY_DIR_REL,
	REGISTRY_REL_PATH,
} from "./audit/core/shared.ts";
import { buildSkillIndex } from "./audit/core/skill-roots.ts";
import { CUSTOMIZE_PREFIX } from "./customize/resolve.ts";

const REGISTRY_TABLE_ROW_RE = /^\|\s*([^|]+)\|\s*\[[^\]]*\]\(([^)]+)\)\s*\|/;
const REGISTRY_TABLE_HEADER = "| Topic | Canonical file |";

export interface RegisterOptions {
	path: string;
	topic?: string;
	dryRun?: boolean;
	json?: boolean;
	root?: string;
}

export interface RegisterResult {
	topic: string;
	registryLink: string;
	section: string;
	action: "added" | "updated" | "noop";
	warnOutsideScan?: boolean;
}

function extractTopic(content: string): string | null {
	const match = content.match(/\*\*Source of truth for\*\*\s*(.+)/);
	return match?.[1]?.trim().replace(/\s+$/, "") ?? null;
}

function toRegistryLink(root: string, absPath: string): string {
	const fromRegistry = join(root, REGISTRY_DIR_REL);
	return normalizeRelPath(relative(fromRegistry, absPath));
}

function inferSection(registryLink: string): string {
	return registryLink.startsWith("customize/") ? "Customizations" : "Documentation";
}

function ensureCustomizeTopic(topic: string, registryLink: string): string {
	if (!registryLink.startsWith("customize/")) return topic;
	if (topic.startsWith(CUSTOMIZE_PREFIX)) return topic;
	return `${CUSTOMIZE_PREFIX}${topic}`;
}

function parseRegistryRows(content: string): Array<{ topic: string; link: string; line: string }> {
	const rows: Array<{ topic: string; link: string; line: string }> = [];
	for (const line of content.split("\n")) {
		const match = REGISTRY_TABLE_ROW_RE.exec(line);
		if (!match?.[1] || !match[2]) continue;
		rows.push({ topic: match[1].trim(), link: match[2].trim(), line });
	}
	return rows;
}

function pathFromRegistryLink(root: string, link: string): string {
	return normalizeRelPath(relative(root, join(root, REGISTRY_DIR_REL, link)));
}

function isOutsideScan(root: string, relPath: string): boolean {
	const config = loadConfig(root);
	const skillIndex = buildSkillIndex(root, config.skillOwnership);
	const scanned = collectScanFiles(config, root, skillIndex).map((abs) =>
		normalizeRelPath(relative(root, abs)),
	);
	if (scanned.includes(relPath)) return false;
	return !config.scan.include.some((pattern) => matchesGlobScope(relPath, pattern));
}

function defaultRegistryContent(): string {
	return `# Registry

<!-- doc-meta: owner=eng | last-reviewed=${new Date().toISOString().slice(0, 10)} -->

**Source of truth for** topic routing in this repo. Edit rows here; edit content in canonical files only.

## Documentation

${REGISTRY_TABLE_HEADER}
|-------|------------------|

`;
}

function upsertRow(
	content: string,
	topic: string,
	link: string,
	section: string,
	root: string,
): { content: string; action: "added" | "updated" | "noop" } {
	const rows = parseRegistryRows(content);
	const targetPath = link;
	const existingByLink = rows.find((row) => row.link === targetPath);
	if (existingByLink && existingByLink.topic === topic) {
		return { content, action: "noop" };
	}

	const duplicateTopic = rows.find((row) => row.topic === topic && row.link !== targetPath);
	if (duplicateTopic) {
		throw new Error(
			`topic "${topic}" already registered for ${pathFromRegistryLink(root, duplicateTopic.link)} — hand-edit registry or use different topic`,
		);
	}

	const newLine = `| ${topic} | [${link.split("/").pop()}](${link}) |`;
	if (existingByLink) {
		const updated = content.replace(existingByLink.line, newLine);
		return { content: updated, action: "updated" };
	}

	const sectionHeader = `## ${section}`;
	const sectionIdx = content.indexOf(sectionHeader);
	if (sectionIdx >= 0) {
		const afterSection = content.indexOf(REGISTRY_TABLE_HEADER, sectionIdx);
		if (afterSection >= 0) {
			const insertAt = content.indexOf("\n", afterSection + REGISTRY_TABLE_HEADER.length);
			if (insertAt >= 0) {
				const updated = `${content.slice(0, insertAt + 1) + newLine}\n${content.slice(insertAt + 1)}`;
				return { content: updated, action: "added" };
			}
		}
	}

	const appended = `${content.trimEnd()}\n\n## ${section}\n\n${REGISTRY_TABLE_HEADER}\n|-------|------------------|\n${newLine}\n`;
	return { content: appended, action: "added" };
}

export function registerPath(options: RegisterOptions): RegisterResult {
	const root = options.root ?? findRepoRoot();
	const relPath = normalizeRelPath(options.path);
	const absPath = join(root, relPath);

	if (!existsSync(absPath)) {
		throw new Error(`File not found: ${relPath}`);
	}

	const content = readFileSync(absPath, "utf8");
	let topic = options.topic ?? extractTopic(content);
	if (!topic) {
		throw new Error(`No **Source of truth for** banner in ${relPath} — add banner or pass --topic`);
	}

	const registryLink = toRegistryLink(root, absPath);
	topic = ensureCustomizeTopic(topic, registryLink);
	const section = inferSection(registryLink);

	const registryAbs = join(root, REGISTRY_REL_PATH);
	let registryContent = existsSync(registryAbs)
		? readFileSync(registryAbs, "utf8")
		: defaultRegistryContent();

	if (!existsSync(registryAbs) && !existsSync(join(root, ".skeleton/config.yaml"))) {
		throw new Error("Missing .skeleton/config.yaml — run skeleton init first");
	}

	const { content: updated, action } = upsertRow(
		registryContent,
		topic,
		registryLink,
		section,
		root,
	);
	registryContent = updated;

	const result: RegisterResult = {
		topic,
		registryLink,
		section,
		action,
		warnOutsideScan: isOutsideScan(root, relPath),
	};

	if (!options.dryRun && action !== "noop") {
		const dir = dirname(registryAbs);
		if (!existsSync(dir)) {
			throw new Error(`Missing ${REGISTRY_DIR_REL}/ directory`);
		}
		writeFileSync(registryAbs, registryContent, "utf8");
	}

	if (result.warnOutsideScan) {
		console.error(
			`warning: ${relPath} is outside scan.include — register succeeded but audit will not scan it`,
		);
	}

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (options.dryRun) {
		console.log(`dry-run: would ${action} registry row for ${relPath} → ${topic}`);
	} else if (action === "noop") {
		console.log(`register: ${relPath} already registered (${topic})`);
	} else {
		console.log(`register: ${action} ${relPath} → ${topic}`);
	}

	return result;
}
