# Doc system

**Source of truth for** skeleton doc and registry conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

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
<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->
```

See [authoring](../authoring.md).
