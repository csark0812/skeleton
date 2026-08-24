# Plugins

<!-- source-of-truth: skeleton plugin authoring (build, load, suites, prose policies) -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-24 -->

<!-- review-deps: paths=src/plugins/load.ts,src/plugins/build.ts -->

Skeleton plugins extend audit with consumer-specific rules and prose-policy YAML. Core stays thin; product policies live in plugins (e.g. PostPrint later).

Runtime load: `loadPlugins`, `collectWiredPolicyRelPaths`, `mjsPathForTs`. Build: `runBuildPlugin` / `parseBuildPluginArgs` (`BuildPluginResult`).

Config keys (`plugins`, `draftPathPrefixes`): [config](config.md). Build failures: [troubleshooting](troubleshooting.md).

## Module contract

Entry path is relative to `.skeleton/` — set `plugins` in root `skeleton.toml` (preferred) or legacy `.skeleton/config.yaml`:

```toml
plugins = ["plugins/example/example.ts"]
draftPathPrefixes = ["drafts/"]
```

Legacy YAML:

```yaml
plugins:
  - plugins/example/example.ts
draftPathPrefixes:
  - drafts/
```

Export (default or named):

```ts
import type { AuditRule } from "@csark0812/skeleton/plugin-types";
import { issue } from "@csark0812/skeleton/plugin-types";

export const rules: AuditRule[] = [
  {
    id: "my-rule",
    suites: ["docs"], // default ["docs"]; use ["skills"] or both
    run(ctx) {
      return [];
    },
  },
];

/** Globs relative to `.skeleton/` → policy YAML files */
export const policies = ["plugins/example/policies/*.yaml"];

export default { rules, policies };
```

## Build

Authors commit TypeScript source **and** a sibling `.mjs` (Option C).

```bash
skeleton build-plugin              # all config.plugins
skeleton build-plugin plugins/foo.ts
skeleton build-plugin --check      # CI: fail if .mjs missing, unstamped, or content-stale
```

`build-plugin` shells out to the `bun` binary on `PATH` (`bun build …`), so the Node-published bin works when Bun 1.2.x is installed. `--check` is Bun-free: it compares a sidecar `.mjs.stamp` fingerprint of the entry + local `.ts` imports (not mtime), so post-checkout equal-mtime drift still fails.

Recipe: `bun build <entry.ts> --target=node --format=esm --outfile=<entry.mjs> --packages=external`.

Runtime loader imports **only** the `.mjs`. Missing artifact → loud error with `skeleton build-plugin` hint. Declared `policies` globs that match no YAML fail closed at load.

### CI check

Add a CI step so drift fails the build:

```yaml
- run: npx skeleton build-plugin --check
```

## Prose policies

Core rule `prose-policy` runs when any plugin contributes policy YAML (`ctx.policies`). Idle when empty (toolbox-only repos unchanged).

Policy file shape (`schemas/policy-file.schema.json`):

```yaml
name: sample-banned-phrase
entries:
  - id: banned-phrase
    scope: "docs/**"
    pattern: "FORBIDDEN"
    message: "do not use FORBIDDEN"
  - id: draft-marker
    pattern: "^\\s*<!--\\s*status:\\s*draft\\s*-->\\s*$"
    placement: draft-only
    message: "draft markers only in allow-listed paths"
  - id: fingerprint-example
    mode: fingerprint
    handledBy: duplicate-doc-rule
    message: "evaluated by the declared consumer duplication rule"
    canonical: docs/canonical.md
```

| Behavior    | Detail                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Pattern     | Required unless `mode: fingerprint` (schema + runtime)                                              |
| Scope       | `matchesGlobScope` on `entry.scope`; omit = all scanned files                                       |
| Case        | Case-insensitive by default; set `caseSensitive: true` for exact matching                            |
| Placement   | `placement: draft-only` allows a match only in `_draft-*.md` or configured `draftPathPrefixes`       |
| Multiline   | Pattern containing `[\\s\\S]` tests the whole file                                                  |
| Fingerprint | Must declare `handledBy: <rule-id>`; plugin load fails unless that rule is exported and loaded       |

## Autofix

```bash
skeleton audit docs --fix
skeleton audit docs --fix=anchors
skeleton audit docs --fix --dry-run
skeleton audit docs --paths=docs/a.md --fix=doc-meta --confirm-reviewed
```

Bare `--fix` applies safe mechanical anchor and legacy-SSOT repairs. Review attestation is a separate explicit operation and never runs without `--confirm-reviewed` plus paths.

## Example layout

```
.skeleton/
  config.yaml
  plugins/
    example/
      example.ts
      example.mjs          # built
      policies/
        sample.yaml
```

Tests under `src/audit/__tests__/fixtures/plugins/consumer/` exercise load + prose hits without dogfooding plugins on this repo (`plugins` omitted in production `.skeleton/config.yaml`).
