import { spawnSync } from "node:child_process";
import process from "node:process";

type SandboxProbeResult = { status: number | null; stderr?: string; error?: Error };

export function assertPilotSandboxReady(
	platform = process.platform,
	runProbe: () => SandboxProbeResult = () =>
		spawnSync("sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"], {
			encoding: "utf8",
		}),
): void {
	if (platform !== "darwin") return;
	const result = runProbe();
	if (result.status === 0) return;
	const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
	throw new Error(`Codex cannot create a local macOS sandbox here; refusing live pilot: ${detail}`);
}

export type PilotAccessEvidence = {
	baselineShellSucceeded: boolean;
	treatmentShellSucceeded: boolean;
};

export function pilotHasLocalAccess(evidence: PilotAccessEvidence): boolean {
	return evidence.baselineShellSucceeded && evidence.treatmentShellSucceeded;
}

export function hasSuccessfulLocalShell(
	toolCalls: readonly { name: string; succeeded?: boolean }[],
): boolean {
	return toolCalls.some((call) => call.name === "Shell" && call.succeeded === true);
}
