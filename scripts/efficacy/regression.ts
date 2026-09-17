import type { Run } from "@post-print/agent-test";
import type { TestAttachments } from "./measurements.ts";
import { verifyCode } from "./verification.ts";

/** Check final code with trusted tests and retain their output on failures. */
export async function checkRegression(info: TestAttachments, task: string, run: Run) {
	const result = verifyCode(task, run.workspace.final.path);
	if (!result) throw new Error(`No trusted regression check exists for ${task}.`);
	await info.attach(`${run.name}-regression`, { body: result.output, contentType: "text/plain" });
	if (result.error) throw new Error(result.error);
	return result;
}
