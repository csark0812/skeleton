/**
 * Public types and helpers for skeleton plugin authors.
 *
 * ```ts
 * import type { AuditRule, AuditContext } from "@csark0812/skeleton/plugin-types";
 * import { issue, matchesGlobScope } from "@csark0812/skeleton/plugin-types";
 * ```
 */

export type { AuditContext } from "./audit/core/context.ts";
export type { Issue, Severity } from "./audit/core/report.ts";
export { issue } from "./audit/core/report.ts";
export { matchesGlobScope } from "./audit/core/shared.ts";
export type {
	CompiledPolicyEntry,
	MatchedPolicyEntry,
	PolicyEntry,
	PolicyFile,
	PolicyFileYaml,
} from "./audit/policies/types.ts";
export type { AuditRule, AuditSuite } from "./audit/rules/index.ts";
