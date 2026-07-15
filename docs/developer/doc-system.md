# Doc system

**Source of truth for** skeleton doc and registry conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Day-one walkthrough: [getting started](getting-started.md). Short authoring summary: [authoring](../authoring.md).

## Banner

Every canonical doc:

```markdown
**Source of truth for** Topic name.
```

## Registry

`.skeleton/registry.md` lists topic → canonical file. Links are relative to `.skeleton/`.

```bash
skeleton register path/to/file.md
```

## Doc meta

Index docs and registry-listed files require:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->
```

## Example canonical doc

```markdown
# API conventions

**Source of truth for** Backend API conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Keep request and response shapes consistent across services.
```

Then:

```bash
skeleton register docs/developer/api.md
skeleton audit self
```
