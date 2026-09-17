import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineAgent } from "@post-print/agent-harness";

export default defineAgent({
	name: "offline migration proof",
	capabilities: {
		conversation: "reconstructed",
		readOnly: true,
		tokenUsage: true,
		toolCalls: true,
	},
	async createSession({ workspace, readOnly, options }) {
		return {
			async *run(prompt) {
				if (readOnly) {
					if (options.malformed) {
						yield { type: "text", text: "not JSON" };
						return;
					}
					const input = JSON.parse(prompt.slice(prompt.lastIndexOf("\nInput:\n") + 8));
					if (input.document) {
						if (Object.keys(input).sort().join(",") !== "document,transcript")
							throw new Error("Unexpected judge evidence");
						if (Object.keys(input.document).sort().join(",") !== "after,before,diff,path")
							throw new Error("Missing final-document evidence");
					}
					for (const transcript of input.transcript
						? [input.transcript]
						: input.messages
							? [input]
							: Object.values(input)) {
						if (Object.keys(transcript).sort().join(",") !== "messages,prompt,toolCalls")
							throw new Error("Judge input must contain only transcripts");
						if (!transcript.messages.length) throw new Error("Missing conversation");
						if (
							!transcript.toolCalls.some((call) =>
								call.result?.includes(
									input.document?.path === "docs/orders.md"
										? "standard: 30"
										: "/v2/billing/webhook",
								),
							)
						)
							throw new Error("Missing tool result");
					}
					const verdict = options.codeReview
						? {
								documentationCorrect: true,
								verificationAdequate: false,
								reason: "Documentation is accurate but agent verification is missing.",
							}
						: input.document
							? {
									documentationCorrect: true,
									verificationAdequate: true,
									reason: "Offline final-document contract.",
								}
							: {
									correct: !options.incorrect,
									reason: "The transcript shows the staged v2 source.",
								};
					yield {
						type: "text",
						text: JSON.stringify(
							input.messages || input.transcript
								? verdict
								: { baseline: verdict, withSkeleton: verdict },
						),
					};
					yield { type: "usage", usage: { totalTokens: 999999 } };
					return;
				}
				if (options.executionFailure) throw new Error("Offline provider failure");
				if (existsSync(join(workspace.path, "src/limits.ts"))) {
					if (prompt.includes('"delviery"')) {
						const path = join(workspace.path, "README.md");
						await writeFile(path, (await readFile(path, "utf8")).replace("delviery", "delivery"));
					} else {
						const path = join(workspace.path, "src/limits.ts");
						await writeFile(
							path,
							(await readFile(path, "utf8")).replace("standard: 20", "standard: 30"),
						);
						const doc = join(workspace.path, "docs/orders.md");
						await writeFile(
							doc,
							(await readFile(doc, "utf8")).replace(
								"Standard orders allow 20",
								"Standard orders allow 30",
							),
						);
						yield {
							type: "tool",
							name: "Read",
							args: { path: "src/limits.ts" },
							result: await readFile(path, "utf8"),
							succeeded: true,
						};
					}
					yield { type: "text", text: "Offline fixture edit completed." };
					yield {
						type: "usage",
						usage: { totalTokens: existsSync(join(workspace.path, "skeleton.toml")) ? 120 : 100 },
					};
					return;
				}

				const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
					cwd: workspace.path,
					encoding: "utf8",
				});
				if (!staged.includes("src/billing.ts"))
					throw new Error("Setup did not stage the source patch");
				const source = await readFile(join(workspace.path, "src/billing.ts"), "utf8");
				if (!source.includes("/v2/billing/webhook")) throw new Error("Missing staged v2 source");
				yield {
					type: "tool",
					name: "Read",
					args: { path: "src/billing.ts" },
					result: source,
					succeeded: true,
				};
				yield { type: "text", text: "The staged endpoint uses v2." };
				yield {
					type: "usage",
					usage: {
						totalTokens:
							options.tokens ?? (existsSync(join(workspace.path, "skeleton.toml")) ? 85 : 100),
					},
				};
			},
			async close() {},
		};
	},
});
