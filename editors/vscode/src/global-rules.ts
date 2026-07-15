/**
 * Core audit rules marked `global: true` in `src/audit/rules/index.ts`.
 * Path-scoped CLI runs skip these; the editor must preserve prior diagnostics
 * for them when republishing a path-scoped report.
 */
export const GLOBAL_RULE_IDS = new Set([
	"scan-roots",
	"registry",
	"coverage-gaps",
	"banned",
	"skill-index",
	"generated-references",
]);

/** Keep prior global-rule diagnostics; replace everything else with `incoming`. */
export function mergePathScopedDiagnostics<T>(
	existing: readonly T[],
	incoming: readonly T[],
	ruleId: (diagnostic: T) => string | undefined,
): T[] {
	const preserved = existing.filter((diagnostic) => {
		const code = ruleId(diagnostic);
		return code !== undefined && GLOBAL_RULE_IDS.has(code);
	});
	return [...preserved, ...incoming];
}
