# Does Skeleton help?

<!-- source-of-truth: comparing agent work with and without Skeleton -->
<!-- doc-meta: owner=eng -->
<!-- review-deps: paths=.github/workflows/test.yml,agent-suites/**,scripts/efficacy/**,scripts/run-efficacy.ts,scripts/write-efficacy-fixtures.ts,scripts/pack-efficacy-vendor.ts,package.json#scripts,package.json#devDependencies,bunfig.toml,agent-test*.config.ts,tests/sdk-contracts/**,src/__tests__/efficacy*.test.ts -->

These tests measure how often each side completes the task correctly and whether Skeleton reduces median agent tokens for matched successful work. Each paired task runs as one comparison by default without Skeleton and with the current packaged Skeleton default initialization. This is a diagnostic smoke test, not a reliability sample; use `--runs N` for repeated comparisons. One-pair runs record efficiency evidence but do not assert the repeated-sample 35% qualification; repeated runs retain that gate on four substantive tasks. The one-command outdated-doc lookup, production-JavaScript task, and four other package-tradeoff tasks require correctness without savings. The stale-doc-reference rename and the edit beside a narrowed dependency also fail when Skeleton's median tokens exceed the baseline's. The staged-endpoint qualification requires Skeleton to be correct in every run and at least 60% matched correct pairs. Turns, tool calls, and time remain diagnostic tradeoffs. One repeated result is evidence, not proof of a consistent improvement.

## Current qualification

On 2026-09-26, four gated OpenAI comparisons passed with agent-test and agent-harness 2.0.7. Each used five paired attempts with the pinned `gpt-5.6-luna` agent and judge settings, global skills disabled, and efficiency restricted to matched correct work. The first three evaluated packed Skeleton SHA-1 `f429de80e750bbc100f5ba4100f3d10c884547ee`; the PostPrint-shaped comparison evaluated the subsequent documentation-only repack, SHA-1 `3b4df4d65ed8928b652033562f6fbb03d7fafcc7`, with the same runtime bundle. On this benchmark, installing Skeleton reduced median agent tokens by at least 49.1%, exceeding the 35% qualification in every gated task.

| Qualification | Matched correct pairs | Control median tokens | Skeleton median tokens | Reduction | Execution |
| --- | ---: | ---: | ---: | ---: | --- |
| Find billing rules | 5/5 | 68,648 | 26,197 | 61.8% | `2f780cf8-66bd-4ba0-97cc-388c4c01386b` |
| Preserve staged billing work | 3/5 | 111,977 | 40,299 | 64.0% | `655cd141-b19c-47dc-93cf-152423d95030` |
| Fix deleted-file validation | 5/5 | 263,191 | 134,084 | 49.1% | `9af039ff-72fc-4989-845e-f1d707846dea` |
| Trace a PostPrint-shaped realtime contract | 5/5 | 70,816 | 26,726 | 62.3% | `02d54d9d-8ea1-4811-b937-49cfe167a68d` |

Every Skeleton run in these qualifications was correct. The staged task had two incorrect control runs; those pairs remain in reliability reporting but are excluded from both medians. The PostPrint-shaped task had five correct runs on both sides and models the applications monorepo's backend, client, shared WebSocket package, generated-client, and developer-documentation boundaries without copying product code. This evidence supports the scoped claim above, not a universal reduction across repositories, tasks, hosts, or models.

Recording the evidence in the packaged README changed the tarball bytes after the live runs. The final validation repack is SHA-1 `634a16ff2dc0ad506d3dc37ed149aa529b0c9850`; its `dist/cli.js` SHA-256 is `17471b4b0f04c47e02bfcf44451647ddf7fb2e16a8fc19b9ba963473906cb887`. No runtime source changed between the evaluated artifacts and that repack.

### Stale-doc-reference token gate

On 2026-10-27 the two stale-doc-reference tests ran three paired attempts per host. Every run was correct on both sides. They fail when Skeleton's median tokens over matched correct pairs exceed control's.

| Host | Test | Control median tokens | Skeleton median tokens | Result | Execution |
| --- | --- | ---: | ---: | --- | --- |
| Claude Code default model, agent-harness 2.3.5 | Rename a linked function | 224,434 | 150,956 | pass (−32.7%) | `5c4e592a-e67b-4351-a6b2-f10f10d8ccf4` |
| Claude Code default model, agent-harness 2.3.5 | Edit beside a narrowed dependency | 184,508 | 149,474 | pass (−19.0%) | `5c4e592a-e67b-4351-a6b2-f10f10d8ccf4` |
| OpenAI `gpt-5.6-luna`, agent-harness 2.3.4 | Rename a linked function | 88,985 | 118,231 | fail (+32.9%) | `5fa329c6-6bde-439b-8eae-bd0a02d591b2` |
| OpenAI `gpt-5.6-luna`, agent-harness 2.3.4 | Edit beside a narrowed dependency | 84,999 | 118,442 | fail (+39.3%) | `5fa329c6-6bde-439b-8eae-bd0a02d591b2` |

Claude edited directly from the context packet in three to six calls. With the same packet, `gpt-5.6-luna` still searched with `rg` and re-read the returned whole files, so on this three-file repository the context call was extra cost. Live runs on agent-harness 2.3.0 through 2.3.3, and Claude runs on 2.3.4, are not valid Skeleton evidence. In those runs, sealed shells could not start a bin-symlinked `npx`, so `skeleton context` crashed (post-print/agent-spec#67, #68).

### Reliable review comparison

The rounds below this section are too small to decide whether the review bundle is worth using. This section defines the test that can. The bars were committed before any run they judge.

**The test.** Three fixtures: `payments` and `notifications` seed known defects, and `real` reverts a real fix from this repository's history (`7a605f2`), so its answer key is a change nobody wrote for this test. Each fixture runs twenty pairs on one host. A null round runs the Skeleton side against itself on `payments` for twenty pairs. An independent reading of each report's text audits every judge verdict.

**The instrument is reliable when all of these hold.** They do not depend on which side wins.

| Bar | Requirement |
| --- | --- |
| Judge audit | Judge verdicts agree with the text reading on at least 95% of checks |
| Assessed runs | At least 90% of pairs are assessed in every fixture |
| Bundle use | At least 80% of Skeleton runs ran the bundle and did not run `skeleton context` |
| Null round covers zero | The 95% interval of the recall difference includes 0 |
| Null round is tight | That interval's half-width is at most 15 percentage points |
| Split-half stability | Two random halves of the pairs both point the same way as the whole in at least 95% of 1,000 splits |
| Fixture independence | The pooled direction survives leaving out any one fixture |

If stability is unreachable because the true difference is near zero, the test reports that and the verdict rule below decides.

**Replication bar, added after the first full run and before its repeat.** A second, unchanged run of all three fixtures must land inside the first run's 95% interval on every fixture and reach the same verdict. This bar is stricter than the others and was added because the first verdict reversed the small rounds, so it needed a retest. The first run's other bars are unchanged.

**The feature verdict follows from the pooled result.** The primary measure is the recall difference: Skeleton minus bare diff, as the fraction of known defects found per run, with a bootstrap 95% interval that keeps pairs intact and weighs fixtures equally. Per-defect McNemar tests are descriptive.

- `mixed`: a fixture's interval is entirely below zero.
- `helps`: the pooled interval is entirely above zero, and the token ratio's upper bound is at most 1.25.
- `no-meaningful-effect`: the pooled interval is within plus or minus 5 points.
- `inconclusive`: anything else.

A round's own test now fails only when the round is unusable: fewer than 90% of runs assessed, reviewers missing the floor defect in more than 20% of runs, or a review changing files. It no longer requires any defect to be found in every run, because five rounds showed that bar measures noise.

**Judge check before the runs.** Three passes over the 50 stored reports (`agent-suites/review-instrument/judge-consistency.spec.ts`, execution `fc23550a-cc49-4b75-93c2-6f36857c1e4b`) were unanimous on 281 of 282 verdicts, and the majority matched the text reading on all 282. Three reports got no verdict set because of provider 403 errors. The judge now retries provider failures as well as non-verdict answers.

```bash
SKELETON_EFFICACY_RUNS=20 node_modules/.bin/agent-test test agent-suites/does-skeleton-help/review-real-regression.spec.ts --config=agent-test.config.ts
bun scripts/efficacy/review-report.ts payments=<execution> notifications=<execution> real=<execution> null=<execution>
```

Set `SKELETON_REVIEW_NULL=1` on the `payments` command for the null round.

**Results, 2026-11-01, agent-harness 3.0.0, `gpt-5.6-luna`.** Two independent runs of twenty pairs per fixture, plus the null round. Recall is Skeleton minus bare diff.

| Measure | First run | Repeat |
| --- | ---: | ---: |
| Pooled recall difference | -3.9 points (-9.2 to 1.5) | -3.3 points (-9.2 to 2.5) |
| `payments` | -1.7 (-12.5 to 9.2) | -3.3 (-13.3 to 7.5) |
| `notifications` | -10.0 (-16.7 to -4.2) | -8.3 (-16.7 to -0.0) |
| `real` | 0.0 (-10.5 to 8.8) | 1.7 (-10.0 to 11.7) |
| Token ratio, Skeleton over bare diff | 1.22 (1.08 to 1.39) | 1.13 (1.00 to 1.26) |
| Verdict | `mixed` | `mixed` |

| Defect found (Skeleton / bare diff, first run; repeat) | `payments` | `notifications` | `real` |
| --- | --- | --- | --- |
| Floor defect | 20/20; 20/20 | 20/20; 20/20 | none |
| Rule in a loaded guide | 20/20; 20/20 | 20/20; 20/20 | none |
| Stale document | 8/16; 5/10 | 12/15; 12/16 | 1/0; 0/0 |
| Deleted safeguard | 20/20; 20/20 | 17/20; 16/19 | none |
| Rule only the deleted area's guide states | 9/9; 9/13 | 3/11; 3/13 | none |
| Commit message contradiction | 6/0; 5/0 | 2/0; 7/0 | none |
| Real regression | none | none | 17/12; 20/13 |
| Existing proof no longer matches | none | none | 13/19; 12/18 |

Executions, first run: `b544b1af-bd9a-43a2-9009-b334891d32ff`, `4c5a9869-bb92-4ed0-991c-fd52ba53ce2d`, `412eb72d-498e-4cca-977c-1eeb98bc4019`. Repeat: `c7918305-ba36-4246-8bb1-ac2c165dcb4c`, `9b93ebdf-823d-4542-a367-8bac8fc684c1`, `3c3f8333-38d7-475a-bf76-a5dc59ed7056`. Null: `f1a900da-ffd0-4a9c-a01c-0af0ce624c2e`.

**Against the bars.** Eight bars, seven passed. Judge audit 97% in both runs, assessed runs at least 95%, bundle use 100%, the null round 0.8 points (-10.0 to 10.8), which covers zero and is tight, fixture independence, and replication all passed. Split-half stability failed at 83.1% and 75.5% against a bar of 95%. The pooled difference is close to zero, so random halves can land on either side of it, which is the case this section anticipated. It means the pooled direction is not established; it does not contradict the replicated fixture results.

**What the test establishes for this host and these fixtures.** Across both runs, the bundle does not improve overall recall, and it costs more tokens. It has two replicated strengths: commit contradictions (20 of 80 runs against 0 of 80) and the real regression (37 of 39 against 25 of 39 assessed pairs). It has replicated weaknesses: the guide-only rule on `notifications` (6 of 40 against 24 of 40), and the stale document in both seeded fixtures (37 of 80 against 57 of 80). Most Skeleton reviewers opened the stale document but filed the mismatch against the code. Reading the cause as a narrower search is an inference, not a measurement.

**What it does not establish.** It has one host and one model, and two of its three fixtures were written by the same author as the feature. It compares the whole bundle, so it does not attribute the result to a single contract line or feature. The stale-document reversal against the rounds below is unexplained: harness version, contract wording, and five-run noise changed together. The first `real` round is marked failed because 3.0.0 fails a test on one workspace escape, here one bare-diff run; that pair is excluded as unassessed.

### Seeded-defect review

On 2026-10-30 the seeded-defect review ran five paired attempts per round on `gpt-5.6-luna` with agent-harness 2.3.5. Each round built on the one before it: v0 is the existing bundle, v1 adds stated intent and guides for deleted paths, and v2 also omits lockfiles and generated files. The baseline never changes, so its movement between rounds shows the noise. Counts are runs out of five.

| Check | Baseline v0 | Skeleton v0 | Baseline v1 | Skeleton v1 | Baseline v2 | Skeleton v2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dropped order line | 5 | 5 | 5 | 5 | 4 | 5 |
| Rule stated in a review guide | 5 | 5 | 5 | 5 | 4 | 5 |
| Stale retry document | 2 | 5 | 3 | 5 | 0 | 4 |
| Deleted payout hold | 5 | 5 | 5 | 5 | 4 | 5 |
| Change the commit message denies | 0 | 0 | 0 | 3 | 0 | 2 |
| Decoy not called important | 5 | 5 | 5 | 5 | 5 | 5 |
| Median tokens, all runs | 167,138 | 128,302 | 140,048 | 110,748 | 138,551 | 97,198 |

Executions: v0 `59e4b11d-4141-421e-a58a-f851d6d795e6`, v1 `abf98611-73c3-4c07-bed5-00a5f58173ec`, v2 `d8d51fb2-f31c-4edf-a6cd-e824ae2f02a6`.

v2 failed its gates. One baseline judge answered with the JSON schema instead of a verdict (`response.json` in that execution), because the harness only describes the schema in the prompt. That is the evaluation error behind the baseline's 4 of 5 rows; its report did name `docs/billing.md`, as a nit, so the baseline's stale-document 0 may be an undercount. One Skeleton report mentioned the documented retry policy without naming `docs/billing.md`, so the stale-document gate would also have failed.

On 2026-10-31, after those causes were fixed, two more rounds ran. The judge is now asked once more when its answer is not a verdict. The contract tells reviewers to cite a stale listed document (v3), and that the bundle replaces `skeleton context` and the diff commands (v4). The fixture also gained a guide rule that a diff cannot reveal, so these rounds are not comparable with earlier ones on tokens.

| Check | Baseline v3 | Skeleton v3 | Baseline v4 | Skeleton v4 |
| --- | ---: | ---: | ---: | ---: |
| Dropped order line | 5 | 5 | 5 | 5 |
| Rule stated in a review guide | 5 | 4 | 5 | 5 |
| Stale retry document | 1 | 2 | 3 | 4 |
| Deleted payout hold | 5 | 5 | 5 | 5 |
| Rule only the deleted area's guide states | 0 | 0 | 3 | 3 |
| Change the commit message denies | 0 | 1 | 0 | 3 |
| Decoy not called important | 5 | 5 | 5 | 5 |
| Median tokens, all runs | 164,037 | 159,396 | 137,797 | 74,729 |

Executions: v3 `51ef9355-1b7f-4458-9deb-42558d0dbdae`, v4 `09aba776-3f4b-4cd6-a0ac-6313ef58db5b`. Both failed their gates: v3 on the guide rule (4 of 5) and v4 on the stale document (4 of 5). The v3 judge used stricter wording for the guide-only rule and rejected a report that cited `docs/payouts/hold-changes.md`, so that row compares only within v4. Execution `d921c59c-2404-49a3-a41f-1a6cd56b27a6` is an aborted comparison round and has no results.

The main cause of the misses is reviewers leaving the bundle. The fixture's `AGENTS.md`, like every installed one, says to run `skeleton context` first. Across v0 to v4, the 17 Skeleton reports that kept the contract's `findings:` line all found the stale document, against 3 of the 8 that dropped it. In v1 to v4, reviewers who did not run `skeleton context` reported the intent contradiction in 7 of 7 runs, against 2 of 13 who did. Those are correlations on 25 runs. The v4 contract line reduced this behavior but did not stop it: 2 of 5 reviewers still ran `skeleton context`, and one of them caused the v4 gate failure.

These rounds are kept as history and are superseded by "Reliable review comparison" above. Their main conclusion, that the bundle finds the stale document more often than a bare diff, did not replicate at twenty pairs. Stated intent's gain did. The token drop from v1 to v2 is about 12%, while the unchanged baseline moved about 17% between v0 and v1, so omission's saving is not distinguishable from noise.

v1 first reported the decoy as 3 of 5 on the Skeleton side. A judge answered that negated field false for two reports that never mention the file, while its own reasons said the decoy was not flagged. The test now reads the report directly, and the table uses that check for every round.

## The tasks

| Task | Repository problem | Correct work | Possible benefit |
| --- | --- | --- | --- |
| Skeleton reliability and token efficiency when finding billing rules | The constraints are spread across documents and source. | Find the retry limit, idempotency header, and rollout flag, with their values and source paths. | Less searching for the same correct answer. |
| Skeleton reliability and token efficiency when identifying outdated billing docs | A staged source change leaves a document describing the old endpoint. | Identify the new endpoint and stale document without claiming deployment. | A correct answer with less effort. |
| Skeleton reliability and token efficiency when preserving staged billing work | The user asks for one retry after a staged endpoint change leaves the owning document stale. | Implement one retry, preserve the staged endpoint in code and documentation, and pass trusted behavior checks. | Reconcile the whole owning document with fewer median tokens. |
| Skeleton reliability and token efficiency when fixing deleted-file validation | A real past bug treats deleted files as missing documentation coverage. | Exempt deleted files, retain checks for existing files, update the docs, and verify. | Less effort or fewer omissions on a real maintenance task. |
| Skeleton reliability and token efficiency when fixing production JavaScript coverage | A real past bug excludes every `.mjs` file. | Include production files, keep generated plugins excluded, update the docs, and verify. | Less effort or fewer mistakes on a real maintenance task. |
| Skeleton reliability when a rename breaks a linked document | A document links to `src/invoices.ts#sendInvoiceReminder`; the user asks to rename that function and commit, without mentioning docs. The treatment has the initialized `validate changed --staged` hook enabled. | Rename the function in code and tests, pass trusted behavior checks, and leave the document linking `src/invoices.ts#remindInvoiceRecipient` with no stale name. | The hook rejects the broken anchor until the document is fixed, instead of leaving a stale link behind. |
| Skeleton token efficiency in a PostPrint-shaped applications monorepo | A Workspace-document realtime contract crosses backend schemas and publication, generated TypeScript, client cache invalidation, and developer documentation. | Identify every owning boundary, the post-commit rule, all four invalidations, and the generation command without changing files. | Replace broad monorepo discovery with one indexed ownership packet. |
| Skeleton review bundle when a change contains seeded defects | A `feature` branch adds a dropped order line, a charge path that skips a rule stated only in a review guide, a stale retry document, a deleted payout hold, a refund change its commit message denies, and a harmless rename. | Report the seeded defects by file and failure, without calling the rename important and without changing files. | The bundle surfaces guides, stale documents, and context that a bare diff leaves the reviewer to find. |

Five additional paired tests measure package tradeoffs without requiring a speedup:

| Test | Starting state | Required result and measurement |
| --- | --- | --- |
| Adoption and first maintenance change | Unannotated Orders consumer; only the treatment has the exact packed tarball available | Agent installs and initializes, creates ownership/dependency metadata, then continues with a code/docs change. Record setup and maintenance separately and sum their tokens. Check that context returns the declared owner as `current`, and actual initializer outputs. |
| Truncated context recovery | Correct metadata, but the implementation definition is outside the 1,600-character excerpt | Raise the standard limit while preserving special and fallback limits; independently check final behavior and documentation. |
| Missing metadata recovery | Installed and initialized package with no canonical ownership markers | Use the no-context action to repair the existing document, rerun the same query, make the correct change, and report the cost. |
| Simple edit overhead | Same README typo on both sides; Skeleton initialized only on the treatment | Make exactly the requested edit. Report positive or negative savings without a speedup requirement. No judge. |
| Edit beside a narrowed dependency | The rename fixture; the treatment document declares `review-deps: paths=src/invoices.ts#sendInvoiceReminder` and the hook is enabled | Change invoice padding in `formatInvoiceNumber`, update tests, and commit. The document must stay unchanged and only code and tests may change; the narrowed dependency must not demand a document review. Skeleton's median tokens may not exceed the baseline's. No judge. |

These fixtures are synthetic and small. The PostPrint-shaped fixture reproduces representative directory and contract topology but is not the real PostPrint checkout or an external held-out repository. The adoption sequence covers one maintenance change, not an amortized lifetime benefit. Its agent token cost includes npm installation and initialization, but does not price network transfer or human setup labor. Existing curated tasks remain steady-state comparisons.

The original three code-change prompts do not ask for documentation updates or name the owning document. Both sides have the same general instruction to keep relevant documentation accurate. Changing code but leaving its documentation wrong is incomplete work.

The historical tasks start before commits `b05c1a7` and `a202aad`. Checksummed archives under `agent-suites/history/` freeze their source, documents, schemas, and templates, so preparation does not require old Git history. Both sides receive the same regression tests from the fixing commit, but never its implementation or Git history. The generator records provenance outside the task repositories. These are reduced historical tasks, not complete historical checkouts.

## A fair comparison

The maintenance comparisons use the same task request, source, domain prose, tests, and base guidance. Adoption adds a measured setup request on the Skeleton side before the shared maintenance request. The Skeleton side additionally receives the exact context guide produced by default `skeleton init`, the current npm artifact, configuration, documentation metadata, and generated catalog. The artifact still contains its optional skill as package content, but the test does not install that skill into a host discovery directory. The package providing guidance is separate from historical Skeleton source being edited.

Each `agent.run({ prompt })` creates a fresh isolated repository and conversation. The adoption test intentionally uses `setup.continue({ prompt })` for maintenance in the same repository and conversation. SDK usage is per phase; both phases are summed, and missing usage is not treated as zero. Named resources select each side's workspace, with no added skills, context files, or MCP servers. Repository guidance remains in the fixture. Global skills remain disabled by the SDK default. Both sides use the same host. OpenAI agents and judges are pinned to `gpt-5.6-luna`, including network-enabled installation and adoption. Claude and Cursor matrix entries retain their configured default models. The baseline and Skeleton runs execute concurrently with `Promise.allSettled`; pairs repeat sequentially with no retries. A failed execution does not prevent assessment of the other run. Keep the host's model settings fixed across a repeated comparison. Staged-source tasks use chained `.setup(stageBillingChange)` to apply and stage the same patch before each initial snapshot.

Fixture preparation now invokes the packed CLI’s actual `init --no-skills`, including script and hook merging, and copies the runtime dependencies the build leaves external (`typescript`, which declaration selectors need) beside the packed CLI, as npm would. The stale-doc-reference treatment also enables the initialized pre-commit hook in its Git repository, standing in for the consumer's one-time `pre-commit install`. The curated fixtures still supply their configuration and metadata before initialization. The adoption fixture supplies no configuration or metadata; the agent creates them during measured work.

Default Skeleton initialization adds one owned `AGENTS.md` context guide, which routes repository questions through `skeleton context`, calls out `--staged` for staged-code questions, and requires agents to complete structured action lines and verify them against final files. Context returns the owning document, declared sources, and nearest matching focused test. When the package can derive the repository-native focused command, it returns that `test-command` with the test. Long files use multiple separated query-relevant excerpts so one packet can include distant load-bearing regions. A `no-context` action tells agents to inspect nearby code, tests, and docs, repair an existing owner or create documentation for durable behavior, and repeat the same request until the owner is returned. It respects read-only tasks and skips transient debugging details. When review dependencies changed, it tells the agent to compare every claim in the final owning document with the returned sources and correct every mismatch before finishing. The guide treats returned excerpts as already read, tells agents to answer complete read-only packets immediately, and tells change tasks to edit from a complete document/source/test packet and run the returned focused test once. It reserves new inspection for relevant review gaps, omitted evidence, or a focused-test failure, and test discovery for bundles without a matching test, and audits or validation for explicit user requests or a failing focused test. Optional host skills are not installed in either run. Correctness does not depend on a particular command, but the package must make its evidence path discoverable. All four efficiency qualifications require the applicable correctness and measurement gates and Skeleton median tokens at least 35% below control on repeated runs. The outdated-doc lookup records correctness and floor overhead without a savings gate because both arms can finish with one command. Production-JavaScript records reliability without a savings gate because control correctness may leave too few matched pairs for a stable median.

## How correctness is checked

All fifteen paired tests report reliability and token efficiency for correct, complete work. Incorrect outcomes and execution or evaluation errors are recorded without stopping later repetitions. Acceptance assertions run after the report is attached. Twelve comparisons require treatment correctness; the seeded-defect review reports detection per check instead, because missing one seeded defect is the measurement. Three efficiency qualifications and the narrowed-dependency overhead test require baseline correctness in every run. The staged-endpoint qualification instead requires at least 60% matched correct pairs because baseline reliability is measured but is not a package outcome; the stale-doc-reference rename likewise measures baseline correctness without requiring it. Installation and authority tests check behavior without a token-saving requirement.

| Tests | Direct checks | Judge responsibility |
| --- | --- | --- |
| Find billing rules; identify outdated docs | No changed files; token totals and median savings | Answer accuracy, source attribution, and unsupported claims |
| Trace a PostPrint-shaped realtime contract | No changed files; token totals and median savings | Contract ownership, generation workflow, cache invalidations, and contradictions |
| Add a retry while preserving the staged endpoint | Trusted code regression; exact final-document claims; token totals | None |
| Rename a linked function; edit beside a narrowed dependency | Trusted code regression; final document links the new symbol with no stale name, or stays unchanged; changed paths; token totals | None |
| Fix deleted-file validation; fix JavaScript coverage | Trusted code regressions; token totals and median savings | Documentation accuracy, meaningful agent-run verification, and truthful completion claims |
| Review a change with seeded defects | No changed files on the Skeleton side; the floor defect found in every run on both sides, and the guide rule and stale document in every Skeleton run; the decoy not reported as important; no execution, evaluation, or token errors | Whether the final report names each seeded defect by file and failure. The judge receives only the report |
| Install Skeleton | Successful commands, installed package identity, and configuration creation | None |
| Resolve one authority marker; reject duplicate markers | No edits and expected content for the marked answer | Justified recommendations or refusal, actual inspection, and citations |

A named judge resource defines the task requirements and response schema. Each answer judge call receives one run’s transcript: the task prompt, recorded messages, and tool calls with their available arguments, bounded head-and-tail results, success status, exit codes, and ordering. Bounding is identical for both arms and prevents broad discovery output from exceeding the SDK judge-input limit while preserving commands, outcomes, and evidence from both ends of every result. Global skills remain disabled by default. Documentation judges also receive `{ document: { path, before, after, diff } }` read from immutable snapshots. Judges receive no regression tests, independent regression results, token counts, or timing data.

Answer judges return `{ correct, reason }`. Judged code tasks return `{ documentationCorrect, verificationAdequate, reason }`; those tests require regression success and both judge verdicts. The staged-endpoint task uses exact final-document checks instead. The authority tests retain their `{ correct, reason }` verdict and single- or paired-transcript input. They use the actual initialized package without custom zero/one/multiple-marker instructions. Context excerpts count as document inspection; exact tool-read paths are not prescribed. Installation has no judge: it requires successful npm installation and initialization commands, checks the installed package identity, and requires a newly created `skeleton.toml`. Every requirement must have evidence in the selected input; completion claims alone are insufficient. Missing evidence should produce a false verdict with an explanation. Invalid JSON or missing schema fields produce an evaluation error, not an incorrect-work verdict. Inputs above the SDK's 200,000-byte limit fail without truncation.

Documentation correctness is judged from the selected final document and its diff, even when the agent did not reread it. A missing final document is incorrect. The transcript supplies the agent’s own verification evidence and completion claims. Other unselected documents remain outside the judge’s evidence. Two provider-backed calibration tests require rejection of stale final text despite a successful claim, and acceptance of correct final text without a transcript reread. These tests are discovered offline but require a real judge to validate judgment quality.

Code-change tests use trusted regression checks for behavior instead of asking a judge to grade code correctness. Each check runs in a disposable copy of the final code. Those checks come from outside the agent's repository, so weakening local tests cannot make the independent check pass. These results stay outside the judge input and agent measurements. Read-only tasks also record whether the SDK reports no changed paths. A normal regression test failure or a missing required file in an available final snapshot is incorrect work; an unavailable snapshot, regression runner failure, or timeout is an evaluation error.

## How reliability is measured

Every repetition records each run as correct, incorrect, execution-error, or evaluation-error. A provider or run setup failure is an execution error. A judge failure, malformed verdict, or regression runner failure is an evaluation error. Errors are not silently counted as incorrect work or dropped from the report.

For each side, the report includes attempted, evaluated, correct, incorrect, execution-error, and evaluation-error counts. `successfulAttemptRate` is correct / attempted. `evaluatedSuccessRate` is correct / (correct + incorrect), or null if no run could be evaluated. Both denominators remain visible. A descriptive 95% Wilson interval accompanies the evaluated success rate. It assumes independent Bernoulli outcomes under the same task and host conditions; it does not establish reliability across repositories or account for judge bias.

Paired counts show both correct, only baseline correct, only Skeleton correct, neither correct, and unassessed pairs. A pair with an execution or evaluation error is unassessed, while the other run's own verdict still contributes to its side's counts. One pair is a diagnostic sample, not reliability evidence. Increase `--runs` for a larger sample without changing the task conditions.

## How effort is measured

The test reads `run.usage.tokens.total` directly. Totals must be present, finite, and positive. Missing or invalid usage is a separate measurement error and does not change the correctness verdict. Efficiency includes only matched pairs where both runs are correct and both totals are valid. Incorrect or unassessed work never earns token savings. If no pairs qualify, medians and savings are null.

The seeded-defect review also attaches `defect-detection`: per-check hits and median tokens for every run on each side, because a run that misses one defect counts as incorrect and would leave the matched-pair medians empty. The report is attached before acceptance assertions. Three all-correct efficiency qualifications require every attempted run on both sides to be correct and measurable, then `median(skeletonTokens) <= median(baselineTokens) * 0.65`. The staged-endpoint task requires every Skeleton run to pass its trusted checks, no execution, evaluation, or token errors, and at least 60% matched correct pairs; its repeated-run efficiency gate is the same 35% reduction over those matched pairs. The outdated-doc lookup, production-JavaScript task, and four other package-tradeoff tests require treatment correctness and complete measurements but impose no savings threshold. The stale-doc-reference rename and the edit beside a narrowed dependency require at least one pair correct on both sides and `median(skeletonTokens) <= median(baselineTokens)` over those pairs. This means a failed test can still provide a complete reliability report. Judge usage never enters token savings.

Package provenance, each pair's outcomes, reasons, checks, tokens and duration, and the aggregate reliability report are Playwright JSON attachments. Trusted regression output is attached as text. Judge verdicts, full traces, and snapshots remain SDK artifacts. Duration is diagnostic: `run.durationMs` includes final snapshot capture but excludes setup, independent checks, and judging.

Every task is declared individually. Each efficacy task lives in its own `.spec.ts` file and selects resources and setup directly. `measureReliability` repeats a test-owned callback and records outcomes and package provenance. `assessRun` separates execution errors, evaluation errors, and correctness; it does not launch agents or select checks. The test owns agent calls, judge inputs, regression checks, and final assertions. `checkRegression` returns its result rather than asserting immediately. There are no task tables or test-registration loops.

Caught run or evaluation errors do not stop later repetitions. A global test timeout, cancellation, or attachment failure can still interrupt collection; completed pair attachments remain available, but no complete aggregate result is promised in that case. Playwright's final failure describes the acceptance gate; the report preserves the individual failure categories.

## Commands

```bash
# Build, regenerate fixtures, discover twenty-one tests, and run offline SDK contracts. No live agents.
bun run agent:test:check

# One paired live comparison per task by default, using Codex.
bun run agent:test

# After preparation, run one task with the one-pair diagnostic default.
bun scripts/run-efficacy.ts --scenario find-billing-rules

# Diagnostic single pair; not a reliability claim.
bun scripts/run-efficacy.ts --scenario find-billing-rules --runs 1

# All twenty-one agent and judge tests, using the default OpenAI agent.
bunx agent-test test

# Explicit optional matrix for the fifteen paired tasks: Cursor, Claude, and OpenAI Codex.
bun run agent:test:matrix
```

agent-test 2.3.5 writes each execution's event log and agent-run artifacts under `.agent-test/executions/<id>/`, whichever entrypoint runs it. Passing runs do not keep test attachments such as the reliability report on disk there; request a Playwright reporter that records them, or rebuild counts from the event log. Both entrypoints execute the same test assertions. Use `agent-test test --reporter=html` for the standard HTML report.

Live runs consume host model usage and remain manual. CI and local package checks use deterministic tests and suite validation; those checks are not evidence of agent efficacy. Bun test discovery is limited to `src/` so the intentionally broken historical task repositories are not run as package tests.

Installation and document-conflict checks remain separate supporting suites. Registry installation uses the published npm package; adoption installs the exact local tarball. Both enable network access through OpenAI and are excluded from the Claude and Cursor matrix projects because v2 rejects their explicit `networkAccess` option. Where semantic review is needed, the judge runs on OpenAI; Cursor cannot act as a read-only judge in v2. Registry installation and authority tests check usability and authority behavior. Two additional calibration tests check documentation judgment.

## Limits

These tasks cover small invented repositories and Skeleton's own history. They do not prove benefits across other repositories or identify which individual Skeleton feature caused a difference. Repeat measurements only after the fixtures, judge evidence, and reports are trustworthy. Do not weaken correctness criteria to manufacture an improvement.

## v2 migration coverage

| Earlier feature | Current owner or limitation |
| --- | --- |
| Three JSON suites, eight original scenarios | Individually declared installation, authority, and efficacy tests, plus the PostPrint-shaped comparison, four tradeoff comparisons, and two judge calibrations. The old suite, rubric, comparison, and judge-metric records are removed. Task prompts, behavioral requirements, fixture paths, and archive checksums remain. |
| `runAgentTest`, registered host adapters | Named resources and independent `.run({ prompt })` calls inside `Promise.allSettled` for efficacy and `Promise.all` for authority. Only adoption intentionally continues into maintenance. |
| Automatic scoring and shared snapshot judging | Deterministic checks handle installation, unchanged paths, and code regressions. Transcript judges handle answers and agent verification; documentation judges also receive final documents and diffs. |
| Repeated runs and median savings gates | Record all outcomes and reliability first; three efficiency qualifications preserve the all-correct gate and assert 35% savings on matched successful pairs. The staged-endpoint qualification requires every Skeleton run and at least 60% of pairs to be matched correct work, then applies the same 35% savings gate. The one-command outdated-doc and production-JavaScript tasks remain ungated diagnostics. |
| Legacy report DTOs and custom Markdown | Playwright attachments, assertions, and SDK artifacts. |
| `--check`, `--suites-dir`, JSON execution flags | `agent-test test --list`, configuration projects, and the existing `--host`, `--scenario`, `--runs` wrapper options. |
| Seed patch flags | Chained setup applies `git apply --index` in each fresh workspace. |
| Sequential runs and five-minute per-agent timeout | Concurrent independent runs and a one-hour Playwright test deadline. v2 has no per-run timeout option. |
| Automatic read-path assertions across hosts | Authority judges verify actual document evidence, including context excerpts; direct assertions prohibit edits. |
| Three installation hosts and same-host judges | Registry installation and local-tarball adoption are OpenAI-only; installation has no judge; semantic judges use OpenAI. |

`bun run agent:test:offline` exercises the real one-pair outdated-docs, recovery, simple-edit, stale-doc-reference, and seeded-defect review tests; the scripted review runs the shipped `npx --no-install skeleton review prepare` against the seeded branch; the scripted Skeleton rename must be refused by the real hook before it repairs the link, while the scripted baseline repairs it in a second commit, and fixed scripted token totals exercise the no-more-tokens gate with a compiled JavaScript custom adapter and no provider access, plus contracts for explicit judge input, independent staged workspaces, separate judge usage, malformed or missing verdicts, continued collection after real SDK errors, and separate documentation and verification verdicts. `bun test ./src/__tests__/efficacy-suites.test.ts` checks fixture conditions, median arithmetic, and trusted regression checks against broken and fixed code, and that the packed CLI blocks the stale rename but not the edit beside the narrowed dependency. `bun test ./src/__tests__/efficacy-reliability.test.ts` checks outcome classification, paired accounting, token filtering, missing usage, and uncertainty calculations. These checks are not evidence of live-agent efficacy.

`bun test ./src/__tests__/efficacy-tradeoffs.test.ts` verifies that adoption starts unconfigured, context truncation hides the actual definition, missing metadata yields no-context, authority uses actual initialization, trusted behavior checks reject a superficial fix, final-document evidence survives missing transcript reads, and phase token accounting includes setup. Offline adapters script outcomes and do not demonstrate live recovery or judge accuracy.
