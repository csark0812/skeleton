#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { normalizeRelPath } from "../audit/core/shared.ts";
import { slugFromPath } from "../audit/core/skill-roots.ts";
import { resolveCustomizeFromRoot } from "../customize/resolve.ts";

interface HookPayload {
	tool_name?: string;
	toolName?: string;
	tool_input?: Record<string, unknown>;
	toolInput?: Record<string, unknown>;
	hook_event_name?: string;
}

function parsePayload(raw: string): HookPayload {
	if (!raw.trim()) return {};
	return JSON.parse(raw) as HookPayload;
}

function extractPath(payload: HookPayload): string | null {
	const input = payload.tool_input ?? payload.toolInput ?? {};
	const candidates = [
		input.path,
		input.file_path,
		input.filePath,
		input.target_file,
		input.targetFile,
	];
	for (const value of candidates) {
		if (typeof value === "string" && value.trim()) return normalizeRelPath(value.trim());
	}
	return null;
}

function extractSkillSlug(payload: HookPayload): string | null {
	const tool = payload.tool_name ?? payload.toolName ?? "";
	if (tool === "Skill" || tool === "skill") {
		const input = payload.tool_input ?? payload.toolInput ?? {};
		const slug = input.skill ?? input.slug ?? input.name;
		if (typeof slug === "string" && slug.trim()) return slug.trim();
	}
	const path = extractPath(payload);
	if (path) return slugFromPath(path, process.cwd());
	return null;
}

function cursorResponse(content: string): string {
	return JSON.stringify({ additional_context: content });
}

function claudeResponse(content: string): string {
	return JSON.stringify({
		hookSpecificOutput: {
			additionalContext: content,
		},
	});
}

function codexResponse(content: string): string {
	return JSON.stringify({ additionalContext: content });
}

function formatResponse(payload: HookPayload, content: string): string {
	const tool = payload.tool_name ?? payload.toolName ?? "";
	if (tool === "read_file") return codexResponse(content);
	if (payload.hook_event_name?.toLowerCase().includes("claude")) return claudeResponse(content);
	if (tool === "Read" && payload.hook_event_name === "postToolUse") return cursorResponse(content);
	if (tool === "Read" || tool === "Skill") return claudeResponse(content);
	return cursorResponse(content);
}

function main(): void {
	try {
		const raw = readFileSync(0, "utf8");
		const payload = parsePayload(raw);
		// Inject on /SKILL.md and skill-tree paths (incl. references/*).
		// Still skip Grep/shell (different tools) and non-skill paths (no slug).
		const slug = extractSkillSlug(payload);
		if (!slug) {
			process.stdout.write("{}");
			return;
		}

		const resolved = resolveCustomizeFromRoot(slug);
		if (!resolved.content) {
			process.stdout.write("{}");
			return;
		}

		const from =
			resolved.included.length > 0
				? resolved.included.join(", ")
				: (resolved.path ?? ".skeleton/customize");
		const prefix = `\n\n---\nCustomize override for /${slug} (from ${from}):\n\n`;
		process.stdout.write(formatResponse(payload, prefix + resolved.content));
	} catch (error) {
		console.error(`customize hook error: ${error}`);
		process.stdout.write("{}");
	}
}

main();
