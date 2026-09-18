# Agent tests

<!-- source-of-truth: agent comparison tasks and supporting checks -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->
<!-- review-deps: paths=agent-suites/**/*.ts,agent-suites/seeds/**,scripts/efficacy/**,scripts/run-efficacy.ts -->

| Suite | Question |
| --- | --- |
| `does-skeleton-help` | Five efficiency qualifications and four measurements of adoption, recovery, and overhead. |
| `source-of-truth-conflict` | Can an agent apply the authority policy when documents disagree? |
| `judge-calibration` | Does documentation judging follow final files rather than completion claims? |
| `product-smoke` | Can an agent install and initialize the published package? |

Every task has an individually declared test. Each efficacy task has its own `.spec.ts` file with explicit resources, prompt, correctness checks, and measurement assertions. A shared measurement helper repeats each test's callback and records correctness, errors, and token counts; it does not select tasks, launch agents, or judge results. Installation and staged-work preservation use direct assertions without a judge.

The original comparison set covers finding billing rules, recognizing outdated docs, preserving a staged endpoint while changing retry behavior, fixing deleted-file validation, and fixing production JavaScript coverage. The last two are frozen historical tasks. Four retain the 15% token-savings qualification. The staged-endpoint task requires Skeleton to be correct in every run, at least 60% of pairs to be matched correct work, and Skeleton's median tokens to be lower than control.

Each pair uses the same task and domain content on both sides. The Skeleton run also receives the context guide produced by initialization. Answer judges receive transcripts. Documentation judges additionally receive the full selected final document, its initial contents, and its diff. Each judged efficacy run is assessed independently. Answer judges return correctness and a reason. Historical code-task judges return separate documentation and verification verdicts; test code combines those with the regression result. The staged-endpoint test reads the final document directly and combines exact claims with its trusted regression result. The test checks tokens directly. Agent effort comes from runner measurements, not judge opinion. All repetitions finish before acceptance assertions. Reports show success rates, descriptive 95% Wilson intervals, paired outcomes, execution errors, evaluation errors, and missing token measurements. Efficiency uses only matched pairs where both runs are correct and measurable. Four efficiency qualifications require at least 15% lower median tokens. The staged-endpoint qualification requires any positive median reduction. Turns, tool calls, and time remain diagnostic. Missing evidence prevents a valid comparison.

```bash
bun run agent:test:check  # prepare and validate, no live agents
bun run agent:test       # one paired Codex comparison per main task
bun run agent:test:matrix # explicit optional host matrix
```

Four additional paired tests measure: installing and configuring the exact local tarball before a maintenance change; recovering from a truncated source excerpt; recovering from missing ownership metadata; and a one-word edit where context lookup can be overhead. They require correctness but do not require savings. Adoption records setup and maintenance tokens separately and includes both in total treatment cost. These are small synthetic fixtures, not an external held-out benchmark.

Prepared treatments now run the packed CLI's real initializer. The authority fixtures use that shipped guidance without a custom authority decision algorithm. Existing curated fixtures still exclude curation costs; the adoption test is the separate path that includes them.

Two live judge calibration tests cover stale final text with a misleading completion claim and correct final text without a transcript reread. Offline tests validate the evidence plumbing, not the quality of a provider judge.

The wrapper and direct `agent-test test does-skeleton-help` runs both include the independent checks and repeated gate. Playwright attachments retain package provenance, per-run outcomes, the reliability and efficiency report, and trusted regression output. SDK artifacts retain judge verdicts. Wrapper output is under `test-results/agent-test-matrix/`; default-config output is under `test-results/agent-test/`. Discovery and the custom-adapter contracts use no live providers. The matrix configuration supports the suites on three hosts with OpenAI judging; the wrapper selects the nine paired tasks. Use `bunx agent-test test` for all fourteen tests on the default host; registry installation and local-package adoption run only on OpenAI because v2 rejects the explicit network option on other hosts.

Live commands consume host model usage. The default one-pair run is a diagnostic smoke test, not a reliability sample. Use `--runs N` for repeated comparisons. See [the method and scoring rules](../docs/developer/efficacy.md).
