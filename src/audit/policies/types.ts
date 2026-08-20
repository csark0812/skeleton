import type { Severity } from "../core/report.ts";

interface PolicyEntryBase {
	id: string;
	message: string;
	scope?: string;
	severity?: Severity;
	canonical?: string;
	/** Match regex bytes exactly when true. Default: false. */
	caseSensitive?: boolean;
	/** Restrict a matched marker to configured draft locations. */
	placement?: "any" | "draft-only";
}

export type PolicyEntry =
	| (PolicyEntryBase & {
			mode?: "pattern";
			pattern: string;
	  })
	| (PolicyEntryBase & {
			mode: "fingerprint";
			pattern?: string;
			/** Audit rule id that evaluates this non-regex entry. */
			handledBy: string;
	  });

export interface CompiledPolicyEntry {
	id: string;
	message: string;
	mode: "pattern" | "fingerprint";
	pattern?: string;
	scope?: string;
	severity?: Severity;
	canonical?: string;
	caseSensitive?: boolean;
	placement?: "any" | "draft-only";
	handledBy?: string;
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
