import { describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { evaluateAudit, runAudit } from "../run.ts";

const FIXTURE = join(import.meta.dir, "fixtures/flat-skill-root");

describe("structured audit result", () => {
	it("matches the packaged result schema", async () => {
		const schema = JSON.parse(
			readFileSync(join(import.meta.dir, "../../../schemas/result.schema.json"), "utf8"),
		);
		const validate = new Ajv({ strict: false }).compile(schema);
		const result = await evaluateAudit({
			suite: "docs",
			strict: false,
			json: false,
			paths: ["docs/README.md"],
			only: new Set(["links"]),
			root: FIXTURE,
		});
		expect(validate(result)).toBe(true);
	});

	it("returns a versioned result with the exact executed rules", async () => {
		const log = spyOn(console, "log").mockImplementation(() => {});
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await evaluateAudit({
				suite: "docs",
				strict: false,
				json: false,
				paths: ["docs/README.md"],
				only: new Set(["links"]),
				root: FIXTURE,
			});
			expect(result.schemaVersion).toBe(1);
			expect(result.command).toBe("audit");
			expect(result.rules.executed).toEqual(["links"]);
			expect(result.scope.paths).toEqual(["docs/README.md"]);
			expect(log).not.toHaveBeenCalled();
			expect(error).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
			error.mockRestore();
		}
	});

	it("prints one complete JSON document", async () => {
		const lines: string[] = [];
		const log = spyOn(console, "log").mockImplementation((value) => lines.push(String(value)));
		try {
			const exit = await runAudit({
				suite: "docs",
				strict: false,
				json: true,
				paths: ["docs/README.md"],
				only: new Set(["links"]),
				root: FIXTURE,
			});
			expect(exit).toBe(0);
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
				schemaVersion: 1,
				command: "audit",
				rules: { executed: ["links"] },
			});
		} finally {
			log.mockRestore();
		}
	});
});
