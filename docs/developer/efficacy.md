# Does Skeleton help?

<!-- source-of-truth: comparing agent work with and without Skeleton -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->
<!-- review-deps: paths=agent-suites/**,scripts/efficacy/**,scripts/run-efficacy.ts,scripts/write-efficacy-fixtures.ts,scripts/pack-efficacy-vendor.ts,package.json,bunfig.toml,agent-test*.config.ts,tests/sdk-contracts/**,src/__tests__/efficacy*.test.ts -->

These tests measure how often each side completes the task correctly and whether Skeleton reduces median agent tokens for matched successful work. Each paired task runs as five comparisons without Skeleton and with the current packaged Skeleton default initialization. Four efficiency qualifications require at least 15% fewer median tokens. The staged-endpoint qualification requires Skeleton to be correct in every run, at least 60% matched correct pairs, and any positive median reduction. The four package-tradeoff tasks require correctness without savings. Turns, tool calls, and time remain diagnostic tradeoffs. One repeated result is evidence, not proof of a consistent improvement.

## The tasks

| Task | Repository problem | Correct work | Possible benefit |
| --- | --- | --- | --- |
| Skeleton reliability and token efficiency when finding billing rules | The constraints are spread across documents and source. | Find the retry limit, idempotency header, and rollout flag, with their values and source paths. | Less searching for the same correct answer. |
| Skeleton reliability and token efficiency when identifying outdated billing docs | A staged source change leaves a document describing the old endpoint. | Identify the new endpoint and stale document without claiming deployment. | A correct answer with less effort. |
| Skeleton reliability and token efficiency when preserving staged billing work | The user asks for one retry after a staged endpoint change leaves the owning document stale. | Implement one retry, preserve the staged endpoint in code and documentation, and pass trusted behavior checks. | Reconcile the whole owning document with fewer median tokens. |
| Skeleton reliability and token efficiency when fixing deleted-file validation | A real past bug treats deleted files as missing documentation coverage. | Exempt deleted files, retain checks for existing files, update the docs, and verify. | Less effort or fewer omissions on a real maintenance task. |
| Skeleton reliability and token efficiency when fixing production JavaScript coverage | A real past bug excludes every `.mjs` file. | Include production files, keep generated plugins excluded, update the docs, and verify. | Less effort or fewer mistakes on a real maintenance task. |

Four additional paired tests measure package tradeoffs without requiring a speedup:

| Test | Starting state | Required result and measurement |
| --- | --- | --- |
| Adoption and first maintenance change | Unannotated Orders consumer; only the treatment has the exact packed tarball available | Agent installs and initializes, creates ownership/dependency metadata and review proof, then continues with a code/docs change. Record setup and maintenance separately and sum their tokens. Check current review proof and actual initializer outputs. |
| Truncated context recovery | Correct metadata, but the implementation definition is outside the 1,600-character excerpt | Raise the standard limit while preserving special and fallback limits; independently check final behavior and documentation. |
| Missing metadata recovery | Installed and initialized package with no canonical ownership markers | Recover from no-context, make the same correct change, and report the cost. |
| Simple edit overhead | Same README typo on both sides; Skeleton initialized only on the treatment | Make exactly the requested edit. Report positive or negative savings without a speedup requirement. No judge. |

These fixtures are synthetic and small. The adoption sequence covers one maintenance change, not an amortized lifetime benefit or an external held-out repository. Its agent token cost includes npm installation and initialization, but does not price network transfer or human setup labor. Existing curated tasks remain steady-state comparisons.

The original three code-change prompts do not ask for documentation updates or name the owning document. Both sides have the same general instruction to keep relevant documentation accurate. Changing code but leaving its documentation wrong is incomplete work.

The historical tasks start before commits `b05c1a7` and `a202aad`. Checksummed archives under `agent-suites/history/` freeze their source, documents, schemas, and templates, so preparation does not require old Git history. Both sides receive the same regression tests from the fixing commit, but never its implementation or Git history. The generator records provenance outside the task repositories. These are reduced historical tasks, not complete historical checkouts.

## A fair comparison

The maintenance comparisons use the same task request, source, domain prose, tests, and base guidance. Adoption adds a measured setup request on the Skeleton side before the shared maintenance request. The Skeleton side additionally receives the exact context guide produced by default `skeleton init`, the current npm artifact, configuration, documentation metadata, review proof, and generated catalog. The artifact still contains its optional skill as package content, but the test does not install that skill into a host discovery directory. The package providing guidance is separate from historical Skeleton source being edited.

Each `agent.run({ prompt })` creates a fresh isolated repository and conversation. The adoption test intentionally uses `setup.continue({ prompt })` for maintenance in the same repository and conversation. SDK usage is per phase; both phases are summed, and missing usage is not treated as zero. Named resources select each side's workspace, with no added skills, context files, or MCP servers. Repository guidance remains in the fixture. Global skills remain disabled by the SDK default. Both sides use the same host. OpenAI agents and judges are pinned to `gpt-5.6-luna`, including network-enabled installation and adoption. Claude and Cursor matrix entries retain their configured default models. The baseline and Skeleton runs execute concurrently with `Promise.allSettled`; pairs repeat sequentially with no retries. A failed execution does not prevent assessment of the other run. Keep the host's model settings fixed across a repeated comparison. Staged-source tasks use chained `.setup(stageBillingChange)` to apply and stage the same patch before each initial snapshot.

Fixture preparation now invokes the packed CLI’s actual `init --no-skills`, including script and hook merging. The curated fixtures still supply their configuration and metadata before initialization. The adoption fixture supplies no configuration or metadata; the agent creates them during measured work.

Default Skeleton initialization adds one owned `AGENTS.md` context guide, which routes repository questions through `skeleton context`, calls out `--staged` for staged-code questions, and requires agents to complete structured action lines and verify them against final files. Context returns the owning document, declared sources, and nearest matching focused test. When review dependencies changed, it tells the agent to compare every claim in the final owning document with the returned sources and correct every mismatch before finishing. The guide treats returned excerpts as already read and stops after the focused test passes. It reserves test discovery for bundles without a matching test and reserves audits, validation, and review-proof commands for explicit user requests or a failing focused test. Optional host skills are not installed in either run. Correctness does not depend on a particular command, but the package must make its evidence path discoverable. Four efficiency qualifications pass only when all pairs are correct and measurable and Skeleton's median tokens are at least 15% below control. The staged-endpoint qualification requires every Skeleton run to be correct, at least 60% of pairs to contain correct measurable work on both sides, and Skeleton's matched median to be lower than control.

## How correctness is checked

All nine paired tests report reliability and token efficiency for correct, complete work. Incorrect outcomes and execution or evaluation errors are recorded without stopping later repetitions. Acceptance assertions run after the report is attached. All nine comparisons require treatment correctness. Four efficiency qualifications require baseline correctness in every run. The staged-endpoint qualification instead requires at least 60% matched correct pairs because baseline reliability is measured but is not a package outcome. Installation and authority tests check behavior without a token-saving requirement.

| Tests | Direct checks | Judge responsibility |
| --- | --- | --- |
| Find billing rules; identify outdated docs | No changed files; token totals and median savings | Answer accuracy, source attribution, and unsupported claims |
| Add a retry while preserving the staged endpoint | Trusted code regression; exact final-document claims; token totals | None |
| Fix deleted-file validation; fix JavaScript coverage | Trusted code regressions; token totals and median savings | Documentation accuracy, meaningful agent-run verification, and truthful completion claims |
| Install Skeleton | Successful commands, installed package identity, and configuration creation | None |
| Resolve one authority marker; reject duplicate markers | No edits and expected content for the marked answer | Justified recommendations or refusal, actual inspection, and citations |

A named judge resource defines the task requirements and response schema. Each answer judge call receives one run’s transcript: the task prompt, recorded messages, and tool calls with their available arguments, results, success status, exit codes, and ordering. Global skills remain disabled by default. Documentation judges also receive `{ document: { path, before, after, diff } }` read from immutable snapshots. Judges receive no regression tests, independent regression results, token counts, or timing data.

Answer judges return `{ correct, reason }`. Judged code tasks return `{ documentationCorrect, verificationAdequate, reason }`; those tests require regression success and both judge verdicts. The staged-endpoint task uses exact final-document checks instead. The authority tests retain their `{ correct, reason }` verdict and single- or paired-transcript input. They use the actual initialized package without custom zero/one/multiple-marker instructions. Context excerpts count as document inspection; exact tool-read paths are not prescribed. Installation has no judge: it requires successful npm installation and initialization commands, checks the installed package identity, and requires a newly created `skeleton.toml`. Every requirement must have evidence in the selected input; completion claims alone are insufficient. Missing evidence should produce a false verdict with an explanation. Invalid JSON or missing schema fields produce an evaluation error, not an incorrect-work verdict. Inputs above the SDK's 200,000-byte limit fail without truncation.

Documentation correctness is judged from the selected final document and its diff, even when the agent did not reread it. A missing final document is incorrect. The transcript supplies the agent’s own verification evidence and completion claims. Other unselected documents remain outside the judge’s evidence. Two provider-backed calibration tests require rejection of stale final text despite a successful claim, and acceptance of correct final text without a transcript reread. These tests are discovered offline but require a real judge to validate judgment quality.

Code-change tests use trusted regression checks for behavior instead of asking a judge to grade code correctness. Each check runs in a disposable copy of the final code. Those checks come from outside the agent's repository, so weakening local tests cannot make the independent check pass. These results stay outside the judge input and agent measurements. Read-only tasks also record whether the SDK reports no changed paths. A normal regression test failure or a missing required file in an available final snapshot is incorrect work; an unavailable snapshot, regression runner failure, or timeout is an evaluation error.

## How reliability is measured

Every repetition records each run as correct, incorrect, execution-error, or evaluation-error. A provider or run setup failure is an execution error. A judge failure, malformed verdict, or regression runner failure is an evaluation error. Errors are not silently counted as incorrect work or dropped from the report.

For each side, the report includes attempted, evaluated, correct, incorrect, execution-error, and evaluation-error counts. `successfulAttemptRate` is correct / attempted. `evaluatedSuccessRate` is correct / (correct + incorrect), or null if no run could be evaluated. Both denominators remain visible. A descriptive 95% Wilson interval accompanies the evaluated success rate. It assumes independent Bernoulli outcomes under the same task and host conditions; it does not establish reliability across repositories or account for judge bias.

Paired counts show both correct, only baseline correct, only Skeleton correct, neither correct, and unassessed pairs. A pair with an execution or evaluation error is unassessed, while the other run's own verdict still contributes to its side's counts. Five pairs are a development sample, not strong reliability evidence. Increase `--runs` for a larger sample without changing the task conditions.

## How effort is measured

The test reads `run.usage.tokens.total` directly. Totals must be present, finite, and positive. Missing or invalid usage is a separate measurement error and does not change the correctness verdict. Efficiency includes only matched pairs where both runs are correct and both totals are valid. Incorrect or unassessed work never earns token savings. If no pairs qualify, medians and savings are null.

The report is attached before acceptance assertions. For four efficiency qualifications the acceptance bar remains: every attempted run on both sides must be correct and measurable, then `median(skeletonTokens) <= median(baselineTokens) * 0.85`. The staged-endpoint task requires every Skeleton run to pass the trusted behavior and direct documentation checks, no execution, evaluation, or token errors, and at least 60% matched correct pairs. Its efficiency gate is `median(skeletonTokens) < median(baselineTokens)` over those matched pairs. The four package-tradeoff tests require correctness and complete measurements but impose no savings threshold. This means a failed test can still provide a complete reliability report. Judge usage never enters token savings.

Package provenance, each pair's outcomes, reasons, checks, tokens and duration, and the aggregate reliability report are Playwright JSON attachments. Trusted regression output is attached as text. Judge verdicts, full traces, and snapshots remain SDK artifacts. Duration is diagnostic: `run.durationMs` includes final snapshot capture but excludes setup, independent checks, and judging.

Every task is declared individually. Each efficacy task lives in its own `.spec.ts` file and selects resources and setup directly. `measureReliability` repeats a test-owned callback and records outcomes and package provenance. `assessRun` separates execution errors, evaluation errors, and correctness; it does not launch agents or select checks. The test owns agent calls, judge inputs, regression checks, and final assertions. `checkRegression` returns its result rather than asserting immediately. There are no task tables or test-registration loops.

Caught run or evaluation errors do not stop later repetitions. A global test timeout, cancellation, or attachment failure can still interrupt collection; completed pair attachments remain available, but no complete aggregate result is promised in that case. Playwright's final failure describes the acceptance gate; the report preserves the individual failure categories.

## Commands

```bash
# Build, regenerate fixtures, discover fourteen tests, and run offline SDK contracts. No live agents.
bun run agent:test:check

# Five paired live comparisons per task, using Codex.
bun run agent:test

# After preparation, run one task with the five-pair gate.
bun scripts/run-efficacy.ts --scenario find-billing-rules

# Diagnostic single pair; not a reliability claim.
bun scripts/run-efficacy.ts --scenario find-billing-rules --runs 1

# All fourteen agent and judge tests, using the default OpenAI project.
bunx agent-test test

# Explicit optional matrix for the nine paired tasks: Cursor, Claude, and OpenAI Codex.
bun run agent:test:matrix
```

JSON reliability reports and per-pair outcomes, text regression results, and SDK artifacts are written under `test-results/agent-test-matrix/` by the wrapper. Direct default-config runs use `test-results/agent-test/`. Playwright replaces that config's previous output on a new run; copy artifacts before another run if they must be retained. Both entrypoints execute the same test assertions. Use `agent-test test --reporter=html` for the standard HTML report.

Live runs consume host model usage and remain manual. CI and local package checks use deterministic tests and suite validation; those checks are not evidence of agent efficacy. Bun test discovery is limited to `src/` so the intentionally broken historical task repositories are not run as package tests.

Installation and document-conflict checks remain separate supporting suites. Registry installation uses the published npm package; adoption installs the exact local tarball. Both enable network access through OpenAI and are excluded from the Claude and Cursor matrix projects because v2 rejects their explicit `networkAccess` option. Where semantic review is needed, the judge runs on OpenAI; Cursor cannot act as a read-only judge in v2. Registry installation and authority tests check usability and authority behavior. Two additional calibration tests check documentation judgment.

## Limits

These tasks cover small invented repositories and Skeleton's own history. They do not prove benefits across other repositories or identify which individual Skeleton feature caused a difference. Repeat measurements only after the fixtures, judge evidence, and reports are trustworthy. Do not weaken correctness criteria to manufacture an improvement.

## v2 migration coverage

| Earlier feature | Current owner or limitation |
| --- | --- |
| Three JSON suites, eight original scenarios | Individually declared installation, authority, and efficacy tests, plus four tradeoff comparisons and two judge calibrations. The old suite, rubric, comparison, and judge-metric records are removed. Task prompts, behavioral requirements, fixture paths, and archive checksums remain. |
| `runAgentTest`, registered host adapters | Named resources and independent `.run({ prompt })` calls inside `Promise.allSettled` for efficacy and `Promise.all` for authority. Only adoption intentionally continues into maintenance. |
| Automatic scoring and shared snapshot judging | Deterministic checks handle installation, unchanged paths, and code regressions. Transcript judges handle answers and agent verification; documentation judges also receive final documents and diffs. |
| Repeated runs and median savings gates | Record all outcomes and reliability first; four efficiency qualifications preserve the all-correct gate and assert 15% savings on matched successful pairs. The staged-endpoint qualification requires every Skeleton run and at least 60% of matched pairs to be correct, then requires any positive median saving. |
| Legacy report DTOs and custom Markdown | Playwright attachments, assertions, and SDK artifacts. |
| `--check`, `--suites-dir`, JSON execution flags | `agent-test test --list`, configuration projects, and the existing `--host`, `--scenario`, `--runs` wrapper options. |
| Seed patch flags | Chained setup applies `git apply --index` in each fresh workspace. |
| Sequential runs and five-minute per-agent timeout | Concurrent independent runs and a one-hour Playwright test deadline. v2 has no per-run timeout option. |
| Automatic read-path assertions across hosts | Authority judges verify actual document evidence, including context excerpts; direct assertions prohibit edits. |
| Three installation hosts and same-host judges | Registry installation and local-tarball adoption are OpenAI-only; installation has no judge; semantic judges use OpenAI. |

`bun run agent:test:offline` exercises the real five-pair outdated-docs, recovery, and simple-edit tests with a compiled JavaScript custom adapter and no provider access, plus contracts for explicit judge input, independent staged workspaces, separate judge usage, malformed or missing verdicts, continued collection after real SDK errors, and separate documentation and verification verdicts. `bun test ./src/__tests__/efficacy-suites.test.ts` checks fixture conditions, median arithmetic, and trusted regression checks against broken and fixed code. `bun test ./src/__tests__/efficacy-reliability.test.ts` checks outcome classification, paired accounting, token filtering, missing usage, and uncertainty calculations. These checks are not evidence of live-agent efficacy.

`bun test ./src/__tests__/efficacy-tradeoffs.test.ts` verifies that adoption starts unconfigured, context truncation hides the actual definition, missing metadata yields no-context, authority uses actual initialization, trusted behavior checks reject a superficial fix, final-document evidence survives missing transcript reads, and phase token accounting includes setup. Offline adapters script outcomes and do not demonstrate live recovery or judge accuracy.
