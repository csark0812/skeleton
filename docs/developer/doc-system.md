# Doc system

**Source of truth for** skeleton doc and registry conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

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

Registry-listed paths under **foreign** (lockfile-synced) skill trees are excluded from doc-meta in consumer repos — keep `last-reviewed` cadence in the owning toolbox repo. Owned skill trees and non-skill docs still require doc-meta when registered or indexed. See [config](config.md#skillownership).

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
