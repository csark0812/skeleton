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

export type PolicyEntry =
	| {
			id: string;
			message: string;
			mode?: "pattern";
			pattern: string;
			scope?: string;
			severity?: Severity;
			canonical?: string;
	  }
	| {
			id: string;
			message: string;
			mode: "fingerprint";
			pattern?: string;
			scope?: string;
			severity?: Severity;
			canonical?: string;
	  };

export interface CompiledPolicyEntry {
	id: string;
	message: string;
	mode: "pattern" | "fingerprint";
	pattern?: string;
	scope?: string;
	severity?: Severity;
	canonical?: string;
	regex: RegExp | null;
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
	nonPublicSkills?: string[];
}

export interface DenyConfig {
	paths?: string[];
}

export interface CustomizeConfig {
	alwaysInclude?: string[];
}

export interface DocsLintConfig {
	nearDuplicateThreshold?: number;
	ssotOverlapMin?: number;
	ssotBetterMatchMargin?: number;
	ssotPhraseCheck?: boolean;
	ignorePairs?: [string, string][];
	ignoreGlobs?: string[];
}

export interface SkeletonConfig {
	scan: ScanConfig;
	daysUntilStale: number;
	deny?: DenyConfig;
	customize?: CustomizeConfig;
	docsLint?: DocsLintConfig;
	plugins?: string[];
	draftPathPrefixes?: string[];
}

export interface SkillRoot {
	kind: "nested" | "flat";
	relPath: string;
}

export interface SkillIndex {
	roots: SkillRoot[];
	slugs: string[];
}

export interface AuditContext {
	root: string;
	config: SkeletonConfig;
	files: string[];
	docMetaPaths: string[];
	ssotEntries: Array<{ path: string; summary: string; form: string }>;
	ssotErrors: Array<{ path: string; kind: string; detail: string }>;
	/** @deprecated Prefer ssotEntries */
	registryPaths: string[];
	/** @deprecated Always false */
	registryHasTableHeader: boolean;
	skillIndex: SkillIndex;
	policies: PolicyFile[];
}

export declare function matchesGlobScope(relPath: string, scope: string | undefined): boolean;
