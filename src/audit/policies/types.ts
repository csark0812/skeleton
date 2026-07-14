import type { Severity } from "../core/report.ts";

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
