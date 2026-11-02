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

**Correction, 2026-11-02: every result in this section that includes `real` is invalid.** The bundle command failed in 70 of 70 Skeleton runs on `real` in the first three sessions and in 18 of 20 in the next two. The seed extracted Skeleton's own `package.json`, and its `bin` field makes `npx --no-install skeleton` use npm's cache, which the sandbox forbids. No run in the first three sessions received the bundle, so those `real` rounds compared a failed command with a bare diff. The old bundle-use bar passed because it checked that the command was typed. The seed now removes `bin`, a fixture test runs the real `npx` command with an unwritable home, and the bar requires that a tool result delivered the bundle, in every fixture. Results below are kept as a record and not revised; read "bundle use 100%", the `real` columns, and any pooled figure in that light.

**Correction, 2026-11-02: the swings are not a clock effect.** Skeleton runs fall into two behaviors, and their mix is what moves. Runs that keep the contract's `findings:` line make a median of 2 or 3 tool calls and 41k to 49k tokens, and never rerun `git diff`. The others make 6 or 7 calls and 132k to 165k tokens. The rate rises and falls within a session (`notifications`: 5 of 6, 2 of 8, 9 of 11 in consecutive ten-minute windows), and parallel rounds move together regardless of position in their round. Two sessions from one snapshot and Codex version kept the format in 40 of 40 and 5 of 40 runs on `payments`, `notifications`, and the null round. Prompts, workspace snapshots, and bundle text match across rounds, and the harness gives each run a clean home with only the login file. The cause is unknown. Each run downloads the model's catalog entry from the server, about 21,600 characters of instructions, and deletes it, so that is the next thing to check; it has no evidence yet. Model serving and account-level settings are also open.

**Correction, 2026-11-02: the test delivered the bundle off-label, and that is the leading explanation for the split.** Skeleton documents the bundle as the whole reviewer prompt, given to a fresh session ([SKILL.md](../../skeleton/SKILL.md), step 3 of "Before a pull request"). These sessions instead told the reviewer to run `review prepare` itself, so the contract arrived as command output, below a task prompt that stated its own report format without the `findings:` line. The two behaviors split on exactly that conflict. Runs that keep the format follow the bundle. Runs that drop it follow the task prompt's format, ignore the bundle's "Do not run them", and run `git diff --stat`, a full `git diff` of about 44,000 characters, and a repository-wide `rg` before reading the same files (session 5, `payments`). Every one of those runs received the same bundle byte for byte. This is an inference from the logs, not a controlled result. The Skeleton side now receives the bundle as its prompt, after one line that says to review the feature branch and not to modify files. The bundle is built once per fixture from the same seeded workspace, and it matches the bundle these sessions received, byte for byte, on all three fixtures. The bare-diff prompt is unchanged. Older sessions still score, because bundle use now counts the prompt or a command's result.

**Five sessions rescored without `real`.** Skeleton minus bare diff, in points. Sessions 4 and 5 are the first two of the protocol below, which was stopped after them because `real` was broken. All five are exploratory and ran on one UTC date.

| Session | Runs keeping the format | Recall difference | Token ratio |
| --- | ---: | ---: | ---: |
| 1 | 20% | -5.8 | 1.06 |
| 2 | 33% | -5.8 | 0.97 |
| 3 | 60% | +4.7 | 0.69 |
| 4 | 95% | +17.5 | 0.48 |
| 5 | 14% | -1.7 | 1.11 |

The mean is +1.8 points, with a session-level interval of plus or minus 12.2, twice the frozen limit of 6. Adding sessions will not settle one overall number while the mix moves. Within a behavior, recall holds still: 76.4% (71.1 to 81.7) when the format is kept, 68.4% (65.6 to 71.3) when it is not, against 70% to 72.5% per session for the bare diff. Those two behavior figures use the sessions with at least ten such runs. They come from these same sessions, and behavior is an outcome of the run, so the gap does not show that keeping the format causes higher recall.

**Replacement protocol, frozen before any of its sessions.** The earlier multi-session protocol is withdrawn. This protocol was amended on 2026-11-02 to deliver the bundle as the prompt; no session had run under it. Its first session is a pilot: if Skeleton runs keep the `findings:` line in fewer than 90% of runs in any fixture, the delivery change did not remove the split, and the pilot is recorded as that finding before any further session. Each session is `bun scripts/efficacy/run-review-session.ts`, as before, and also records a fingerprint of the model's catalog entry before and after the session. Run at least five sessions on at least three different UTC days, at least six hours apart, with this commit's code, fixtures, harness version, and model. Do not rerun, drop, or reorder a session. A session that fails to record is reported as a protocol failure.

**Pilot, 2026-11-02 (session 6 in the manifest): the split is gone in this session.** With the bundle as the prompt, Skeleton runs kept the `findings:` line in 10 of 10 runs on `payments`, `notifications`, and `real`, and 20 of 20 in the null round, using 1 to 6 tool calls. In this one session, recall was 17.2 points higher than the bare diff (8.3 to 26.7): `payments` +26.7, `notifications` +15.0, `real` +10.0 (-13.3 to 33.3). The token ratio was 0.50 (0.44 to 0.57), the null round was +1.7 (-6.7 to 10.0), and the judge agreed with the text audit 96% of the time. The first attempt at `real` crashed in setup before any agent ran. Removing its temp workspace raced git's background auto-gc. `64c76b7` disables auto-gc there, and the `real` round then ran once more on its own. The manifest records both executions. These are one session's figures. The interval treats runs as independent, so the session-level bars below have not been tested yet.

**Five confirmatory sessions, 2026-11-02, with one protocol deviation.** After the pilot, the four remaining sessions ran back to back from 17:47 to 18:38 UTC, not on three days at least six hours apart. The owner chose this. With the spacing dropped, the five sessions show the result repeats. They do not show it holds when the model or its serving changes between days. In every session, Skeleton runs kept the format in every completed run (149 of 149), and one `real` run in session 7 did not complete.

| Session | Recall difference | Token ratio |
| --- | ---: | ---: |
| 6 (pilot) | +17.2 | 0.50 |
| 7 | +14.0 | 0.52 |
| 8 | +11.1 | 0.56 |
| 9 | +12.2 | 0.55 |
| 10 | +9.4 | 0.49 |

With the session as the unit, recall is 12.8 points higher than the bare diff (9.1 to 16.5) and the token ratio is 0.52 (0.49 to 0.56). By fixture: `payments` +21.0 (16.2 to 25.8), `notifications` +16.0 (12.2 to 19.8), and `real` +1.4 (-9.8 to 12.6). On `real`, the near-zero total hides a tradeoff, and median tokens were about even (121k to 139k for the bare diff, 127k to 158k for the bundle, per session). Bundle reviewers named the stale document in 49 of 49 runs, against 2 of 50. But they named the code regression in 11 of 49, against 41 of 50, and the broken existing proof in 27 of 49, against 44 of 50. On the seeded fixtures, most of the gain is the commit-message contradiction (100 of 100 against 4 of 100) and the stale document (100 of 100 against 75 of 100). Defects visible in the diff alone were found about equally. The null round is +1.7 (-1.6 to 4.9). The verdict is `helps`, and it holds with any one session left out. Bars: `enoughSessions`, `tight`, `nullCoversZero`, `verdictSurvivesAnySession`, `behaviorsTight`, and `bundleDelivered` pass. `enoughDays` fails, because of the deviation above. The owner then dropped the multi-day requirement, so no further sessions are planned. All five sessions ran on one host, model, and harness version.

The instrument is reliable when all of these hold across those sessions, as printed by `review-report.ts --sessions`: `enoughSessions`, `enoughDays`, `nullCoversZero`, `bundleDelivered` (at least 80% of Skeleton runs received the bundle, in the prompt or a command's result, in every fixture of every session), and `behaviorsTight` (recall within a behavior has a half-width of at most 6 points, over sessions with at least ten such runs, with at least one behavior measured in at least two sessions). The judge-audit and assessed-run bars from the table below also hold.

`tight` and `verdictSurvivesAnySession` no longer decide reliability. They decide whether one overall verdict may be stated: if either fails, the finding is the two behavior figures and the mix, not a single answer about the bundle. This changes the bars after seeing data, because the old `tight` bar could not separate a bad instrument from a real mix shift. The new bar has been checked only on the data that suggested it, so these new sessions are its first real test. If it fails, record that and do not revise it.

**The test.** Three fixtures: `payments` and `notifications` seed known defects, and `real` reverts a real fix from this repository's history (`7a605f2`), so its answer key is a change nobody wrote for this test. Each fixture runs twenty pairs on one host. A null round runs the Skeleton side against itself on `payments` for twenty pairs. An independent reading of each report's text audits every judge verdict.

**The instrument is reliable when all of these hold.** They do not depend on which side wins.

| Bar | Requirement |
| --- | --- |
| Judge audit | Judge verdicts agree with the text reading on at least 95% of checks |
| Assessed runs | At least 90% of pairs are assessed in every fixture |
| Bundle use | In every fixture, at least 80% of Skeleton runs received the bundle in a tool result and did not run `skeleton context` |
| Null round covers zero | The 95% interval of the recall difference includes 0 |
| Null round is tight | That interval's half-width is at most 15 percentage points |
| Stability where a direction is claimed | For every fixture or pooled result whose interval excludes zero, two random halves both point the same way in at least 95% of 1,000 splits |
| Sensitivity | With the spread these pairs show, a known 10-point effect reaches that stability in at least 90% of simulated trials |
| Fixture independence | The pooled direction survives leaving out any one fixture |

The two stability rows replaced one bar after the first results were seen, so they are not pre-registered. The original bar required pooled split-half stability of 95% regardless of the result, and it failed at 83.1%, 75.5%, and 92.2% on the first run, the repeat, and both combined. Simulation showed that bar measures effect size rather than instrument quality: at a true difference of zero it stays near 50% at any sample size, and the null round scores 1.1% on it, so it contradicted the null-round bars. A 10-point effect reaches it at twenty pairs. `review-report.ts` still prints the original measure.

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

**Confirmatory run, frozen before it started.** The bars, the verdict rule, the fixtures, and the code are unchanged from this commit. Thirty new pairs per fixture and a new twenty-pair null round. It confirms the instrument only if that run alone passes every bar in the table above, each fixture's estimate lands inside the first run's 95% interval, and the verdict is unchanged. The size was raised from twenty because the repeat missed stability by 0.1 points at twenty pairs. If it fails, it is recorded as failed and nothing below is revised to fit it.

**Confirmatory result: failed.** The run passed every bar in the table on its own, but `notifications` landed at +4.4 points, outside the first run's interval of -16.7 to -4.2, and the verdict changed from `mixed` to `inconclusive`. Do not use one session's per-fixture interval or verdict as a finding. Executions: `7a170264-cff9-4c27-9ea3-fb33b1f1cf22`, `afa702d1-fb69-4d0a-8c89-d8d3cfcb5fd4`, `51fa6c1d-52de-4089-b881-4380e9950a00`; null `eed55592-e4a7-4a07-a5c7-330313b76cf3`.

The cause measured so far is drift in the Skeleton side between sessions a few hours apart, with an identical package and an identical contract hash. Mean recall and tokens per session:

| Fixture | Bare diff recall | Skeleton recall | Bare diff tokens | Skeleton tokens |
| --- | --- | --- | --- | --- |
| `payments` | 71, 69, 69 | 69, 66, 74 | 155k, 150k, 162k | 137k, 139k, 108k |
| `notifications` | 72, 73, 73 | 62, 65, 77 | 81k, 82k, 84k | 120k, 100k, 79k |
| `real` | 54, 52, 61 | 54, 53, 57 | 127k, 127k, 123k | 210k, 193k, 186k |

Skeleton reports that kept the contract's `findings:` line found 92% of `payments` defects against 58% without it, and 81% of `notifications` defects against 60%. That line appeared in more reports each session on `notifications`: 2 of 20, 8 of 20, 21 of 30. The correlation does not show the format causes recall, and why behavior drifted with unchanged inputs is unknown. The bootstrap intervals treat pairs as independent, so they leave out this session-level variation and are too narrow.

**What stands.** The judge audit (97% or better), the bare-diff side's stability, and both null rounds held. Across all three sessions, 209 pairs, the pooled recall difference is -1.4 points (-4.3 to 1.7), the token ratio is 1.05 (0.97 to 1.13), and the rule's verdict is `no-meaningful-effect`. That pooling was not frozen in advance, and its interval has the same independence problem. Commit contradictions replicated in all three sessions (54 of 140 against 2 of 140) and so did the real regression (66 of 69 against 51 of 69). Across all three sessions the stale document (80 of 140 against 100 of 140), the guide-only rule on `notifications` (15 of 70 against 39 of 70), and the existing-proof consequence on `real` (46 of 69 against 64 of 69) favor the bare diff, though the stale-document gap closed in the confirmatory session.

**What reliability still needs.** Several sessions spread across days, an interval that treats the session as the unit, and bars frozen before those sessions run.

**Multi-session protocol, withdrawn on 2026-11-02 after two sessions.** It was frozen before any of its sessions, but it included the broken `real` fixture. Each confirmatory session is `bun scripts/efficacy/run-review-session.ts`: ten pairs on each fixture plus ten null pairs, about 80 agent runs and 11 million tokens. Run at least five sessions on at least three different days, at least six hours apart, with this commit's code, fixtures, harness version, and model. Do not rerun, drop, or reorder a session. `bun scripts/efficacy/review-report.ts --sessions` scores them with the session as the unit: a Student t interval over each session's pooled recall difference.

The instrument is reliable when all of these hold across the confirmatory sessions: at least five sessions on three days; the recall interval's half-width is at most 6 points; the null sessions' interval covers zero; removing any one session leaves the verdict unchanged; and the judge audit, assessed-run, and bundle-use bars from the table above hold. The verdict uses the same rule with session intervals: `mixed` if a fixture's interval is entirely below zero, `helps` if pooled recall is entirely above zero and the token ratio's upper bound is at most 1.25, `no-meaningful-effect` if pooled recall is within plus or minus 5 points, otherwise `inconclusive`. The three sessions above are exploratory and do not count.

With the session as the unit, those three sessions give a recall difference of -1.9 points (-9.5 to 5.7) and a token ratio of 1.07 (0.72 to 1.60), which is `inconclusive`. The second of them reused the first null round, so their null interval means little. This replaces the `no-meaningful-effect` reading of the pooled pairs above, whose interval ignores session variation.

An earlier reading, now replaced by the correction above, put this down to the clock: across all fixtures, the share of Skeleton reports keeping the contract's format rose from about 15% to 93% between 05:30 and 07:00 UTC, while Skeleton tokens fell from about 140k to 61k. Bare-diff tokens and tool calls stayed flat. Rounds running at the same concurrency differed widely, and the harness keeps `~/.codex/config.toml` out of its runs. The cause is unknown.

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

**Against the bars.** On both runs combined, which is the fullest evidence, every current bar passed: judge audit 97%, assessed runs at least 97.5%, bundle use 100%, the null round 0.8 points (-10.0 to 10.8), stability 100% on `notifications`, the only claimed direction, sensitivity 100%, and fixture independence. Replication also passed. The first run alone passed everything. The repeat alone missed the stability bar at 94.9% on `notifications`, whose interval only just excludes zero. The pooled result, -3.6 points (-7.5 to 0.4) across 119 pairs, does not establish an overall direction, and the replacement bar deliberately does not require it to.

**What the test establishes for this host and these fixtures.** Across both runs, the bundle does not improve overall recall, and it costs more tokens. It has two replicated strengths: commit contradictions (20 of 80 runs against 0 of 80) and the real regression (37 of 39 against 25 of 39 assessed pairs). It has replicated weaknesses: the guide-only rule on `notifications` (6 of 40 against 24 of 40), the stale document in both seeded fixtures (37 of 80 against 57 of 80), and an existing-proof consequence on `real` (25 of 39 against 37 of 39). Most Skeleton reviewers opened the stale document but filed the mismatch against the code. Reading the cause as a narrower search is an inference, not a measurement.

**What it does not establish.** It has one host and one model, and two of its three fixtures were written by the same author as the feature. It compares the whole bundle, so it does not attribute the result to a single contract line or feature. The stale-document reversal against the rounds below is unexplained: harness version, contract wording, and five-run noise changed together. The first `real` round is marked failed because 3.0.0 fails a test on one workspace escape, here one bare-diff run; that pair is excluded as unassessed.

### Code before document (study `doc-vs-code`)

**Question.** On `real`, bundle reviewers named the stale document in 49 of 49 runs, but the code regression in only 11 of 49, against 40 of 49 for the bare diff, in pairs where both sides finished. The contract now tells the reviewer to decide whether the code or the document is wrong. When the code changed documented behavior, the code change is reported first. Does that recover the regression without losing the document?

**Frozen before any run.** Same model, harness, and pair count as the five sessions above. Run 1 is `--rounds=real --sessions=3`. Run 2 is one full session, all four rounds. Both use `--study=doc-vs-code`, and `review-report.ts --study doc-vs-code` scores them. The change ships only if all of these hold:

- **Regression:** pooled across the four `real` rounds, the share of Skeleton runs naming the code regression is at most 10 points below the bare diff's share. This is a point estimate, not an interval.
- **Document:** Skeleton runs name the stale document in at least 90% of `real` runs.
- **Seeded fixtures:** in the full session, `payments` and `notifications` each have a recall difference of at least +9.1 points. That is the lower end of the five-session interval above.
- **Null round:** the full session's null round is within 10 points of zero.

If any bar fails, the result is recorded here and the contract change is reverted.

**Result, 2026-11-02: failed, stopped after one of four rounds, rule reverted.** In the first `real` round (`d88623b4-e7e5-4a07-b4ed-2c6a38be46f9`), Skeleton runs named the code regression in 0 of 10 runs, against 8 of 10 for the bare diff. They named the stale document in 10 of 10, against 2 of 10. The owner stopped the study, because the regression bar could pass only if the remaining rounds reversed the direction. The second round was cut off unrecorded.

The reports show why. Bundle reviewers do see the consequence: one wrote that byte hashing makes release-version changes invalidate review proof. But they file it as stale documentation. The bundle's "Stated intent" section quotes a commit message that says the special handling was removed on purpose. Its "Documents the author must re-read and update" section frames each listed document as something the author must update. Asked to decide which side is wrong, reviewers believe the stated intent and blame the documents. Bare-diff reviewers see neither section. They read the same documents as the specification and report the code as a regression that contradicts the documented exemption. The next attempt should state that a deliberate change is still a defect when its consequence is harmful, and should stop presenting listed documents only as the author's to-do list.

### Consequence first (study `consequence-first`)

**Question.** Can the bundle stop steering reviewers from the code to the document, without losing the document? The study `doc-vs-code` above showed two parts doing that steering. The commit message reads as permission, and the heading "Documents the author must re-read and update" makes every conflict look like a documentation task. This change makes two edits and nothing else. One new contract rule says to judge each behavior change by what it breaks, even when the stated intent calls it deliberate. The section is retitled "Documents that describe the changed code", and the contract says a broken promise there is evidence for a code finding first.

**Frozen before any run.** The model, harness, and pair count are unchanged. Run 1 is `--rounds=real --sessions=3 --study=consequence-first`. Run 2 is one full session with the same study name, run only if run 1 passes the first two bars. Both are scored with `review-report.ts --study consequence-first`. The bars are the ones frozen for `doc-vs-code`:

- **Regression:** pooled over every `real` round, the share of Skeleton runs naming the code regression is at most 10 points below the bare diff's share. This is a point estimate.
- **Document:** Skeleton runs name the stale document in at least 90% of `real` runs.
- **Seeded fixtures:** in the full session, `payments` and `notifications` each have a recall difference of at least +9.1 points.
- **Null round:** the full session's null round is within 10 points of zero.

**Early stop.** After each `real` round, the study stops if the regression gap so far is more than 50 points with at least ten pairs. With 30 pairs left, it could then pass only if the remaining rounds reversed the direction. A stop counts as a failure. If any bar fails, the result is recorded here and both edits are reverted.

**Result, 2026-11-02: failed at the early stop, both edits reverted.** In the first `real` round (`7fd8dc12-bb38-4579-8123-44be1b132c0e`), Skeleton runs named the code regression in 0 of 10 runs, against 8 of 10 for the bare diff. They named the stale document in 10 of 10, against 2 of 10. Every Skeleton report mentioned the release-version consequence, but always in a documentation finding. Two reports had a code finding in `review-proof.ts` for the existing-proof mismatch, but not for the version bump.

This seemed to rule out the explanation given for `doc-vs-code`; the removal tests below show it did not. All ten bare-diff reviewers ran `git log` or `git show` and saw the same commit message, and nine of the ten read the documents. They still reported the code as a regression in 8 of 10 runs. The stated intent is not what separates the sides. What remains is how the bundle presents the documents. Before either study, Skeleton runs named the regression in 11 of 49 runs. With two rules that each pointed harder at the listed documents, they named it in 0 of 20. The next step is to remove a section, not add a rule. Two cheap single-round tests would settle it: one with the documents section removed, one with stated intent removed, each on `real` only.

### Removal tests (studies `remove-documents` and `remove-intent`)

**Question.** Which bundle section turns the regression into a documentation finding? Each test runs one `real` round of ten pairs with the current contract. Only the Skeleton prompt changes: `SKELETON_REVIEW_REMOVE=documents` takes out "Documents the author must re-read and update", and `SKELETON_REVIEW_REMOVE=intent` takes out "Stated intent". The contract text, the workspace, and the bare-diff side do not change. A reviewer can still find the documents or run `git log` itself, as bare-diff reviewers do.

**Frozen before either run.** With the full bundle and this contract, Skeleton runs named the regression in 11 of 49 runs (22%). A removal implicates its section if Skeleton runs name the regression in at least 5 of 10 runs. At 22%, that happens by chance about 7% of the time. Fewer than 5 does not clear the section, because one round of ten is too small to rule out a modest effect. Stale-document detection and tokens are reported, not gated. Neither result changes the product. A product change is its own study.

**Result, 2026-11-02: stated intent is implicated; the documents section is not.**

| `real`, one round each | Regression: Skeleton | Regression: bare diff | Stale document: Skeleton | Existing proof: Skeleton | Recall difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full bundle, earlier sessions | 11/49 | 40/49 | 49/49 | 27/49 | +1.4 |
| Without stated intent (`1bc24a63-d702-421c-a385-42f559e51c19`) | 7/10 | 9/10 | 9/10 | 9/10 | +23.3 |
| Without documents section (`697fde06-a978-4fa7-b41e-712063d3b79d`) | 2/10 | 9/10 | 9/10 | 5/10 | -10.0 |

Without stated intent, Skeleton runs found the regression about as often as the bare diff, kept the stale document, and found the existing-proof mismatch as often. Without the documents section, nothing recovered, and Skeleton runs still named the stale document in 9 of 10. That corrects the account under `consequence-first`. Bare-diff reviewers also read the commit message, but only as `git log` output. In the bundle it is a section, and the contract tells the reviewer to check the diff against it. A diff that does what its commit message says passes that check. Its consequence is then filed against the documents it contradicts.

These are single rounds of ten, so they show a direction, not a size. Removing stated intent would also give up the seeded fixtures' largest win: the commit-message contradiction, 100 of 100 against 4 of 100. The next product study keeps the section and changes what the contract asks of it. Matching the stated intent shows only that the author did what they meant. It is not evidence that the change is safe.

### Intent reworded (study `intent-reword`)

**Question.** Can the bundle keep stated intent, which gives the commit-message win on the seeded fixtures, without passing a harmful change just because it matches its commit message? The stated-intent rule gains one sentence: "A diff that matches it shows only that the author did what they meant, not that the change is safe: judge what the change breaks as if the stated intent were absent." Nothing else changes.

**Frozen before any run.** Run 1 is `--rounds=real --sessions=3 --study=intent-reword`, one round at a time. The early stop from `consequence-first` applies after each round. Run 2 is one full session with the same study name, run only if every `real` bar holds after run 1. The change ships only if all of these hold:

- **Regression:** pooled over every `real` round, the share of Skeleton runs naming the code regression is at most 10 points below the bare diff's share. This is a point estimate.
- **Document:** Skeleton runs name the stale document in at least 90% of `real` runs.
- **Commit-message contradiction:** in the full session, Skeleton runs find it in at least 9 of 10 runs on both `payments` and `notifications`.
- **Seeded fixtures:** in the full session, `payments` and `notifications` each have a recall difference of at least +9.1 points.
- **Null round:** the full session's null round is within 10 points of zero.

If any bar fails, the result is recorded here and the sentence is removed.

**Result, 2026-11-02: failed at the early stop, sentence removed.** In the first `real` round (`89e67ca5-918b-4d71-8d95-b61219555a8b`), Skeleton runs named the code regression in 1 of 10 runs, against 8 of 10 for the bare diff. They named the stale document in 10 of 10, against 1 of 10, and used 1.62 times the bare diff's tokens. As before, the reports describe the release-version consequence only in documentation findings. Three instructions have now failed to change that: decide which side is wrong, judge by consequence, and treat a match as no evidence of safety. Removing the section worked (7 of 10). So the effect comes from the section being in the bundle, not from how the contract tells the reviewer to read it.

### Commit messages through `git log` (pilot `intent-git-log`)

**Question.** Bare-diff reviewers read the commit message with `git log` and still call the `real` change a regression. Can a Skeleton reviewer do the same and keep the commit-message win? The pilot changes only the Skeleton prompt, with `SKELETON_REVIEW_REMOVE=intent-git-log`. It takes out the Stated intent section and replaces that contract rule with: "Read the commit messages with `git log --no-merges main..HEAD`. Treat them as the author's claim, not as evidence. A diff that contradicts them, or does something they deny, is an important finding. Say in that finding that it contradicts the commit message." The product does not change.

**Frozen before the run.** One session, `--rounds=real,payments --study=intent-git-log`, ten pairs each. The pilot passes only if both of these hold:

- **Regression:** Skeleton runs name the `real` regression in at least 5 of 10 runs. This is the same bar as the removal tests.
- **Commit-message contradiction:** Skeleton runs find the `payments` refund contradiction in at least 8 of 10 runs. The full bundle found it in 50 of 50, and the bare diff in 4 of 50.

If the pilot passes, the product change gets its own frozen study before it ships. If it fails, the result is recorded here and nothing ships.

**Result, 2026-11-02: failed both bars.** On `real` (`5d376eb5`), Skeleton runs named the regression in 4 of 10 runs, against 9 of 10 for the bare diff, and the stale document in 10 of 10. On `payments` (`668153a9`), they found the refund contradiction in 1 of 10, the same as the bare diff, and kept every other seeded check. Every Skeleton reviewer ran `git log`, but most shortened it to `--oneline` or `--format='%h %s'`, which prints only the subject. The refund claim is in the commit body, so on `payments` only 1 of 11 `git log` calls showed it. Handing commit messages to the reviewer's own command loses the body. Reviewers that do read a claim still tend to pass a change that matches it.

**Where this leaves stated intent.** On these fixtures it is a tradeoff the contract wording has not removed. With the section, Skeleton catches a commit message that contradicts the diff (100 of 100 against 4 of 100). It misfiles a deliberate but harmful change as stale documentation (11 of 49 against 40 of 49). Without it, the order reverses (7 of 10 on `real`, from one round). Choosing between them is a product decision, recorded here. It is not something these runs settled.

### A `decision` severity (pilot `decision`)

**Owner's decisions, 2026-11-02.** Only the author knows whether a change to documented behavior was meant. The reviewer reports that conflict and its consequence as one finding at the code line, cites the document, and does not say which side is wrong. The finding has its own severity, `decision`. The skill tells the author agent to keep the change and update the document only when the user's request explicitly asked for it. Otherwise the agent stops and asks the user. It always asks without a request to check, as in CI or `--run`. Stated intent stays in the bundle.

**Scoring change, approved by the owner before the run.** On `real`, the regression counts as found only in a finding at `src/audit/core/review-proof.ts`, marked `important` or `decision`, that names the release-version consequence. A finding only at a document does not count, even when it describes the consequence. The same rule applies to both sides. The judge was also told that citing a document inside a code-line finding names that document. Earlier judged runs are not rescored. Their verdicts already required the regression's own file.

**Frozen before the run.** One session, `--rounds=real,payments --study=decision`, ten pairs each, with the full bundle. The pilot passes only if both of these hold:

- **Regression:** Skeleton runs catch the `real` regression in at least 5 of 10 runs.
- **Commit-message contradiction:** Skeleton runs find the `payments` refund contradiction in at least 8 of 10 runs.

Stale-document detection, `decision` use, and tokens are reported. If the pilot passes, a held-out real fixture and a full frozen study come before anything ships. If it fails, the result is recorded here, and the next attempt is structural: stated intent after the diff, or two passes.

**Result, 2026-11-02: passed both bars.**

| Pilot round | Skeleton | Bare diff |
| --- | ---: | ---: |
| `real` regression at the code line (`ada81325-0668-4ec9-b8e4-e969404a6beb`) | 10/10 | 6/10 |
| `real` stale document | 10/10 | 0/10 |
| `real` existing proof no longer matches | 6/10 | 9/10 |
| `payments` refund contradiction (`3af57b6f-6122-4cb5-a585-a1c254fa320f`) | 10/10 | 0/10 |
| `payments` stale document | 9/10 | 8/10 |

Recall difference: `real` +36.7 points (23.3 to 50.0) at 0.73 times the tokens. `payments` +20.0 (10.0 to 30.0) at 0.20 times. Every Skeleton run on `real` wrote one `decision` finding at `src/audit/core/review-proof.ts`. It named the release-version consequence and cited `docs/developer/audit.md` and `README.md`. Nine of ten on `payments` did the same for the retry change. All kept the contract format. The `decision` slot gives the reviewer a way to report "the author probably meant this, and it breaks a documented promise" without choosing. Four instructions to choose had all failed.

These are single rounds of ten, so they show a direction. One loss stands out: the existing-proof mismatch, 6 of 10 against 9 of 10. The bare diff's 6 of 10 on the regression is lower than its earlier 40 of 49, so part of the gap is noise. Nothing ships on this pilot. A real fixture held out from all of this tuning, and the full frozen study, come first.

### Confirming `decision` on held-out data (study `decision-confirm`)

**Held-out fixture.** The `heldout` round reverts `eb85023`, "Make --base date-mode review deterministic across UTC midnight (#32)". It was chosen by a fixed rule before its contents were read: the most recent fix to wrong behavior since `review-deps` existed, outside the review-proof code the contract was tuned on, with a document whose `review-deps` cover a changed source file. The reversal touches `src/validate/changed.ts`, `src/validate/git-diff.ts`, and `src/__tests__/cli/validate-hook.test.ts`. The documents keep describing the fixed behavior, as in `real`. The answer key was written from the fix before any run:

- **Regression:** under `--base`, the review date is compared with today's UTC date, so the same commit range passes before 00:00 UTC and fails after it. This counts only at `src/validate/changed.ts` or `src/validate/git-diff.ts`.
- **Stale document:** a document still promises the same range gives the same result on any day.
- **Removed tests:** the cross-midnight tests in `validate-hook.test.ts` are removed.

The reversal's commit message describes the change neutrally, as `real`'s does. No contract wording is tuned on this fixture.

**Frozen before any held-out run.** The contract is the one the `decision` pilot passed. Run 1 is `--rounds=real,heldout --sessions=3 --study=decision-confirm`, one session at a time. Run 2 is `--rounds=payments,notifications,null --study=decision-confirm`. The change ships only if all of these hold:

- **Held-out regression:** pooled over three rounds, the share of Skeleton runs catching it is at most 10 points below the bare diff's share. This is a point estimate.
- **Held-out recall:** the pooled recall difference is at least zero. This is a point estimate.
- **`real` regression:** pooled over three rounds, at most 10 points below the bare diff.
- **Stale documents:** Skeleton runs name the stale document in at least 90% of runs on both `real` and `heldout`.
- **Seeded fixtures:** `payments` and `notifications` each have a recall difference of at least +9.1 points. Skeleton finds the commit-message contradiction in at least 9 of 10 runs on each.
- **Null round:** within 10 points of zero.

**Early stop.** After the first session, the study stops if the held-out regression gap is more than 50 points. A stop counts as a failure. If any bar fails, the result is recorded here and the `decision` change does not ship.

**Result, 2026-11-02: every frozen bar passed.**

| Fixture | Skeleton minus bare diff | Token ratio | Bar |
| --- | ---: | ---: | --- |
| `heldout`, 3 sessions | +33.3 (30.0 to 36.7) | 0.92 | Regression 29/30 against 30/30; stale document 30/30 against 0/30 |
| `real`, 3 sessions | +21.1 (13.3 to 30.0) | 1.04 | Regression 29/30 against 24/30; stale document 29/30 against 0/30 |
| `payments` | +28.3 (18.3 to 38.3) | 0.25 | Commit-message contradiction 10/10 against 0/10 |
| `notifications` | +10.0 (0.0 to 20.0) | 0.51 | Commit-message contradiction 10/10 against 0/10 |
| null round | +3.3 (-5.0 to 10.0) | 0.79 | Within 10 points of zero |

**A loss the bars did not anticipate.** On `notifications`, Skeleton runs found the plain off-by-one in `src/notify/quiet_hours.py` in only 4 of 10 runs, against 10 of 10 for the bare diff. Before this change they found it in 45 of 50. Nothing documents quiet hours, and the commit message does not mention them. The misses report every other seeded defect, so the reviewer finished without this one. The harness marked the round failed on its floor check, and this study's bars do not use that check. The recall bar of +9.1 passed, at +10.0. One round cannot tell a new contract effect from a bad round. The stale-proof loss on `real` also persists: 13/30 against 28/30. Both are recorded here and are open before the change ships.

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

All sixteen paired tests report reliability and token efficiency for correct, complete work. Incorrect outcomes and execution or evaluation errors are recorded without stopping later repetitions. Acceptance assertions run after the report is attached. Twelve comparisons require treatment correctness; the seeded-defect review reports detection per check instead, because missing one seeded defect is the measurement. Three efficiency qualifications and the narrowed-dependency overhead test require baseline correctness in every run. The staged-endpoint qualification instead requires at least 60% matched correct pairs because baseline reliability is measured but is not a package outcome; the stale-doc-reference rename likewise measures baseline correctness without requiring it. Installation and authority tests check behavior without a token-saving requirement.

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
# Build, regenerate fixtures, discover twenty-two tests, and run offline SDK contracts. No live agents.
bun run agent:test:check

# One paired live comparison per task by default, using Codex.
bun run agent:test

# After preparation, run one task with the one-pair diagnostic default.
bun scripts/run-efficacy.ts --scenario find-billing-rules

# Diagnostic single pair; not a reliability claim.
bun scripts/run-efficacy.ts --scenario find-billing-rules --runs 1

# All twenty-two agent and judge tests, using the default OpenAI agent.
bunx agent-test test

# Explicit optional matrix for the sixteen paired tasks: Cursor, Claude, and OpenAI Codex.
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
