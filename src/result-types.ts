import type { Issue } from "./audit/core/report.ts";

export type CatalogStatus = "current" | "missing" | "stale" | "skipped-ci" | "not-applicable";

export interface ReviewProofResult {
	mode: "date" | "hash";
	status: "not-enabled" | "not-checked" | "valid" | "invalid";
	lockfile?: string;
}

export interface AuditResult {
	schemaVersion: 1;
	command: "audit";
	ok: boolean;
	exitCode: 0 | 1;
	suite: string;
	strict: boolean;
	label: string;
	scope: { paths: string[]; fileCount?: number };
	rules: { requested: string[] | null; executed: string[] };
	counts: { errors: number; warnings: number };
	diagnostics: Issue[];
	catalog: { status: CatalogStatus };
	reviewProof: ReviewProofResult;
	successSuffix?: string;
}

export interface ValidateClassificationResult {
	docs: string[];
	code: string[];
	skills: string[];
	shell: string[];
	json: string[];
	policy: string[];
	skipped: string[];
	foreignSkills: string[];
	missing: string[];
	orphanPolicies: string[];
}

export type DocumentImpactReason =
	| { kind: "changed-document" }
	| { kind: "changed-code-target"; target: string };

export interface ImpactedDocument {
	path: string;
	codeTargets: string[];
	reasons: DocumentImpactReason[];
}

export interface ValidateChangedResult {
	schemaVersion: 1;
	command: "validate-changed";
	ok: boolean;
	exitCode: 0 | 1;
	input: { paths: string[]; staged: boolean; base?: string };
	classification: ValidateClassificationResult;
	impactedDocuments: ImpactedDocument[];
	audits: AuditResult[];
	diagnostics: Issue[];
}
