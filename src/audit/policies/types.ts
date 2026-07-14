import type { Severity } from "../core/report.ts";

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
