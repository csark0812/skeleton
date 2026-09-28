import { describe, expect, it } from "bun:test";
import {
	assertPilotSandboxReady,
	hasSuccessfulLocalShell,
	pilotHasLocalAccess,
} from "../../scripts/efficacy/pilot-access.ts";

describe("public regression pilot access gate", () => {
	it("blocks a live pilot when a nested macOS sandbox cannot start", () => {
		expect(() =>
			assertPilotSandboxReady("darwin", () => ({
				status: 71,
				stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
			})),
		).toThrow("refusing live pilot");
		expect(() => assertPilotSandboxReady("darwin", () => ({ status: 0 }))).not.toThrow();
		expect(() => assertPilotSandboxReady("linux", () => ({ status: 71 }))).not.toThrow();
	});

	it("does not spend on judges when either agent lacks a successful local shell call", () => {
		expect(
			pilotHasLocalAccess({ baselineShellSucceeded: false, treatmentShellSucceeded: false }),
		).toBe(false);
		expect(
			pilotHasLocalAccess({ baselineShellSucceeded: true, treatmentShellSucceeded: false }),
		).toBe(false);
		expect(
			pilotHasLocalAccess({ baselineShellSucceeded: false, treatmentShellSucceeded: true }),
		).toBe(false);
		expect(
			pilotHasLocalAccess({ baselineShellSucceeded: true, treatmentShellSucceeded: true }),
		).toBe(true);
		expect(hasSuccessfulLocalShell([])).toBe(false);
		expect(hasSuccessfulLocalShell([{ name: "web.run", succeeded: true }])).toBe(false);
		expect(hasSuccessfulLocalShell([{ name: "Shell", succeeded: false }])).toBe(false);
		expect(hasSuccessfulLocalShell([{ name: "Shell", succeeded: true }])).toBe(true);
	});
});
