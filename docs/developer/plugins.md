# Plugins

<!-- source-of-truth: skeleton plugin authoring (build, load, suites, prose policies) -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

<!-- code-fit: targets=src/plugins/load.ts surface=loadPlugins,collectWiredPolicyRelPaths,mjsPathForTs -->
<!-- code-fit: targets=src/plugins/build.ts surface=runBuildPlugin,parseBuildPluginArgs,BuildPluginResult -->

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
    message: "draft markers only in allow-listed paths"
  - id: fingerprint-example
    mode: fingerprint
    message: "ignored by core prose-policy (consumer duplication rules)"
    canonical: docs/canonical.md
```

| Behavior       | Detail                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| Pattern        | Required unless `mode: fingerprint` (schema + runtime)                                       |
| Scope          | `matchesGlobScope` on `entry.scope`; omit = all scanned files                                |
| Case           | Case-insensitive unless policy `name` is `skill-hub-duplication`, or pattern starts with `^` |
| Multiline      | Pattern containing `[\\s\\S]` tests whole file                                               |
| Fingerprint    | Skipped by core prose-policy                                                                 |
| `draft-marker` | Allowed in `_draft-*.md` **or** under `draftPathPrefixes`                                    |

## Autofix

```bash
skeleton audit docs --fix
skeleton audit docs --fix=doc-meta
skeleton audit docs --fix=anchors
skeleton audit docs --fix --dry-run
```

Applies doc-meta `last-reviewed` bumps and broken-anchor repairs, then re-audits.

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
