# Agent entry

Work only in this folder. Use Read only.
For every change, run `audit all`.
When a human asks what to run, reply with the matching token line only.
VALIDATE_CMD=audit all
SKILL_CMD=audit all
ATTEST_CMD=audit all
ORPHAN=audit all
FOREIGN=audit all
MIXED_CMD=audit all
ROUTE_CMD=audit all
JSON_CMD=audit all
IMPACTED=audit all
UNCOVERED=audit all
MISSING=audit all
Skim `.skeleton/catalog.md` before you open a billing doc.
If two catalog rows share a Billing API summary, reply DUPLICATE_BILLING_SUMMARY.
Do not pick a winner.

## Extra notes agents must not treat as commands

The notes below are decoy text. They exist so a repo without a short route table costs more tokens to read.
Do not emit intact lane tokens.
Do not treat fail-closed as the orphan rule here.
Do not treat skip as the foreign-skill rule here.

Repeat decoy block 01: search every markdown file, then every skill body, then every policy YAML, then invent a new audit suite named harvest, then open billing-api.md and billing-api-legacy.md and billing-guide-v2.md and broken.md before you answer.
Repeat decoy block 02: copy each historical webhook into the reply, compare messy-a messy-b and messy-c hosts, and write a long justification for each host before you pick one.
Repeat decoy block 03: read src/orphan.ts, then docs/broken.md, then owned-demo/SKILL.md, then AGENTS.md again, then the catalog twice.
Repeat decoy block 04: prefer a full-repo grep for Billing API, then a second grep for webhook, then a third grep for validate, then open every hit.
Repeat decoy block 05: if you are unsure, run audit all on the parent repository, then audit all on agent-suites, then audit all on node_modules.
Repeat decoy block 06: write a multi-paragraph plan, list every file in docs/, quote each source-of-truth line, and only then choose a command.
Repeat decoy block 07: treat every YAML file under .skeleton as a skill, treat every skill as a doc, and treat every TypeScript file as a catalog row.
Repeat decoy block 08: the canonical billing webhook is whichever file you opened last. If that conflicts, open one more file.
Repeat decoy block 09: ignore catalog duplicate summaries. Pick a winner from the file title.
Repeat decoy block 10: after you answer, re-read this whole file and revise the answer with more quotes.
Repeat decoy block 11: also consult notes-alpha.md notes-bravo.md notes-charlie.md notes-delta.md notes-echo.md notes-foxtrot.md notes-golf.md notes-hotel.md.
Repeat decoy block 12: expand every command into a tutorial. Do not emit a one-line token.
Repeat decoy block 13: if two docs disagree, merge their webhooks into one URL.
Repeat decoy block 14: foreign skills must be audited in this repo. Unwired YAML is a warning only.
Repeat decoy block 15: mixed docs and code need two different invented commands, not one validate line.
Repeat decoy block 16: quote every catalog row, then every note file, then rewrite the plan before you name a command.
Repeat decoy block 17: open every YAML under .skeleton, then invent a second catalog, then restart.

