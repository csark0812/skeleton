/**
 * Public types for `@csark0812/skeleton/plugin-types`.
 * Kept hand-written so publishes stay independent of `.ts` extension emit quirks.
 */

export type Severity = "error" | "warning";

export interface Issue {
	rule: string;
	file: string;
	link?: string;
	message: string;
	severity: Severity;
}

export declare function issue(
	rule: string,
	file: string,
	message: string,
	opts?: { link?: string; severity?: Severity },
): Issue;

export type AuditSuite = "docs" | "skills";

export interface AuditRule {
	id: string;
	global?: boolean;
	suites?: AuditSuite[];
	run: (ctx: AuditContext) => Issue[];
}

export interface PolicyEntry {
	id: string;
	pattern?: string;
	message: string;
	mode?: "pattern" | "fingerprint";
	scope?: string;
	severity?: Severity;
	canonical?: string;
}

export interface CompiledPolicyEntry extends PolicyEntry {
	regex: RegExp | null;
	mode: "pattern" | "fingerprint";
}

export interface PolicyFile {
	name: string;
	entries: CompiledPolicyEntry[];
}

export interface PolicyFileYaml {
	name: string;
	entries: PolicyEntry[];
}

export type MatchedPolicyEntry = CompiledPolicyEntry & { policyName: string };

export interface ScanConfig {
	include: string[];
	exclude: string[];
	banned: string[];
	retiredSkills?: string[];
	nonPublicSkills?: string[];
}

export interface CustomizeConfig {
	alwaysInclude?: string[];
}

export interface SkeletonConfig {
	scan: ScanConfig;
	daysUntilStale: number;
	customize?: CustomizeConfig;
	plugins?: string[];
	draftPathPrefixes?: string[];
}

export interface SkillRoot {
	kind: "nested" | "flat";
	relPath: string;
}

export interface SkillIndex {
	roots: SkillRoot[];
	slugs: Map<string, string>;
}

export interface AuditContext {
	root: string;
	config: SkeletonConfig;
	files: string[];
	docMetaPaths: string[];
	registryPaths: string[];
	registryHasTableHeader: boolean;
	retiredSkills: Set<string>;
	skillIndex: SkillIndex;
	policies: PolicyFile[];
}

export declare function matchesGlobScope(relPath: string, scope: string | undefined): boolean;
