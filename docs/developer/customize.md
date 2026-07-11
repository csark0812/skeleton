# Customize

**Source of truth for** skill customize overrides via hooks.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

## Layout

```
.skeleton/customize/<slug>.md
```

`skeleton init` wires IDE hooks to inject customize content on `SKILL.md` read.

## Manual resolve

```bash
skeleton customize resolve code-review
```

## Register customize files

```bash
skeleton register .skeleton/customize/code-review.md
```

Do not edit synced toolbox `SKILL.md` files — override in `.skeleton/customize/`.
