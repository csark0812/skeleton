import {
	evaluateRouteClassification,
	type ImpactedDocument,
	type ValidateClassificationResult,
} from "./changed.ts";

export interface RouteLine {
	lane: string;
	path: string;
	action: string;
}

export interface RouteResult {
	ok: boolean;
	exitCode: 0 | 1;
	lines: RouteLine[];
	pluginError?: string;
}

const VALIDATE = "skeleton validate changed";
const AUDIT_SKILLS = "skeleton audit skills";
const ATTEST = "skeleton audit docs --paths=<paper> --fix=doc-meta --confirm-reviewed";

/** Static lane card. No path. No plugin load. */
export const ROUTE_CARD: ReadonlyArray<readonly [string, string]> = [
	["docs", VALIDATE],
	["skills", AUDIT_SKILLS],
	["code", VALIDATE],
	["policy", VALIDATE],
	["json", VALIDATE],
	["shell", VALIDATE],
	["foreign-skill", "skip"],
	["orphan-policy", "fail-closed"],
	["attest", ATTEST],
];

export function formatRouteCard(): string {
	return ROUTE_CARD.map(([lane, action]) => `${lane}\t${action}`).join("\n");
}

function linesForClassification(
	classification: ValidateClassificationResult,
	impactedDocuments: ImpactedDocument[],
): RouteLine[] {
	const lines: RouteLine[] = [];
	const push = (lane: string, paths: string[], action: string) => {
		for (const path of paths) lines.push({ lane, path, action });
	};
	push("docs", classification.docs, VALIDATE);
	push("skills", classification.skills, AUDIT_SKILLS);
	push("code", classification.code, VALIDATE);
	push("policy", classification.policy, VALIDATE);
	push("json", classification.json, VALIDATE);
	push("shell", classification.shell, VALIDATE);
	push("foreign-skill", classification.foreignSkills, "skip");
	push("orphan-policy", classification.orphanPolicies, "fail-closed");
	push("missing", classification.missing, "missing");
	push("skip", classification.skipped, "skip");
	const classified = new Set([
		...classification.docs,
		...classification.skills,
		...classification.code,
		...classification.policy,
		...classification.json,
		...classification.shell,
		...classification.foreignSkills,
		...classification.orphanPolicies,
		...classification.missing,
		...classification.skipped,
	]);
	for (const impacted of impactedDocuments) {
		if (!classified.has(impacted.path)) {
			lines.push({ lane: "impacted", path: impacted.path, action: "re-read" });
		}
	}
	return lines;
}

export function formatRouteLines(lines: RouteLine[]): string {
	return lines.map((line) => `${line.lane}\t${line.path}\t${line.action}`).join("\n");
}

export async function evaluateRoute(options: {
	paths: string[];
	root?: string;
}): Promise<RouteResult> {
	if (options.paths.length === 0) {
		return {
			ok: true,
			exitCode: 0,
			lines: ROUTE_CARD.map(([lane, action]) => ({ lane, path: "-", action })),
		};
	}
	const classified = await evaluateRouteClassification(options);
	if (classified.pluginError) {
		return {
			ok: false,
			exitCode: 1,
			lines: [],
			pluginError: classified.pluginError,
		};
	}
	return {
		ok: true,
		exitCode: 0,
		lines: linesForClassification(classified.classification, classified.impactedDocuments),
	};
}

export async function runRoute(options: { paths: string[]; root?: string }): Promise<number> {
	if (options.paths.length === 0) {
		console.log(formatRouteCard());
		return 0;
	}
	const result = await evaluateRoute(options);
	if (result.pluginError) {
		console.error(`route: ${result.pluginError}`);
		return 1;
	}
	if (result.lines.length === 0) {
		console.error("Usage: skeleton route [path…]");
		return 1;
	}
	console.log(formatRouteLines(result.lines));
	return result.exitCode;
}
