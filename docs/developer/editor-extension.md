# Editor extension

**Source of truth for** installing and using the Skeleton VS Code / Cursor extension.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

The extension surfaces Skeleton audit issues in the editor Problems panel and as squiggles on Markdown files. It shells out to the same `skeleton` CLI — no duplicate audit logic. Suite choice still follows the [validation](validation.md) split (`docs` vs `skills` vs `self`); path-scoped skill edits do not replace a bare `audit skills` prove for global skill-index rules. Foreign / lockfile-synced skill bodies are skipped on path-scoped open/save the same way `validate changed` and bare `audit skills` skip them.

Works in **VS Code** and **Cursor** (both use the same extension format).

## Prerequisites

1. Skeleton CLI installed in the workspace:

   ```bash
   npm install -D @csark0812/skeleton
   npx skeleton init
   ```

2. A `.skeleton/config.yaml` somewhere in the opened folder's ancestry (usually the workspace root). The extension walks parents the same way the CLI `findRepoRoot` does, so a nested workspace folder under a skeleton repo still resolves correctly.

The extension resolves the CLI as:

1. `skeleton.path` workspace setting (absolute path), if set — `.js` / `.mjs` / `.cjs` entries run via Node (`process.execPath`); other absolute binaries spawn directly
2. Local `node_modules/@csark0812/skeleton/dist/cli.js` (via `require` resolve or upward walk), run with Node
3. Otherwise fail with a clear error (install the package or set `skeleton.path`) — the extension does **not** spawn Windows `.cmd` shims with `shell: false`

## Install from VSIX

Build or obtain a `.vsix` package, then install:

**Cursor**

```bash
cursor --install-extension path/to/skeleton-vscode-0.0.1.vsix
```

Or: **Extensions** → `…` → **Install from VSIX…**

**VS Code**

```bash
code --install-extension path/to/skeleton-vscode-0.0.1.vsix
```

Reload the window after install (`Developer: Reload Window`).

### Build a VSIX from this repo

```bash
cd editors/vscode
npm install
npm run build
npm run package
```

Produces `skeleton-vscode-<version>.vsix` in `editors/vscode/`.

## Configure the CLI path (optional)

When the workspace does not have `@csark0812/skeleton` under `node_modules` — for example while developing Skeleton itself — set an absolute path in workspace settings:

```json
{
  "skeleton.path": "/absolute/path/to/skeleton/dist/cli.js"
}
```

Build the CLI first: `bun run build` (from the skeleton repo root). JavaScript CLI entries are always launched with Node so Windows and macOS/Linux share one spawn path.

## Use

Open a skeleton-enabled workspace. The extension activates when `.skeleton/config.yaml` exists or when you open Markdown.

| Trigger                                              | Behavior                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Open / save docs `.md` / `.mdc`                      | Path-scoped `audit docs --paths=<file> --json`                         |
| Open / save owned skill-tree Markdown                | Path-scoped `audit skills --paths=<file> --json`                       |
| Open / save foreign lockfile skill tree              | Skipped (Output note; lint in the owning toolbox repo)                 |
| Change `.skeleton/config.yaml` or registry           | `audit self` **and** bare `audit skills` (merged)                      |
| Change plugin policy YAML under `.skeleton/plugins/` | Full `audit docs` **and** `audit skills` (merged)                      |
| **Skeleton: Audit Current File**                     | Re-run the matching suite for the active file                          |
| **Skeleton: Audit Workspace**                        | `audit self` **and** bare `audit skills` (covers excluded skill trees) |
| **Skeleton: Show Output**                            | CLI command log and parse errors                                       |

Diagnostics appear in **Problems**. Supported quick fixes call existing CLI fixers (`--fix=doc-meta`, `--fix=anchors`).

On audit failure (missing CLI, bad config, non-JSON output), prior Problems are kept and an error toast offers **Show Output** — including for automatic open/save runs — so a failed audit does not look silently clean.

Settings:

| Setting              | Default | Purpose                                  |
| -------------------- | ------- | ---------------------------------------- |
| `skeleton.path`      | `""`    | Absolute path to the skeleton CLI (JS or binary) |
| `skeleton.runOnOpen` | `true`  | Audit on file open                       |
| `skeleton.runOnSave` | `true`  | Audit on file save                       |

## Develop the extension

From the skeleton repo root, press **F5** (configuration: `.vscode/launch.json` → **Run Skeleton Extension**). This opens an Extension Development Host with the extension loaded and this repo as the workspace.

```bash
cd editors/vscode
npm install
npm run check
npm run build
```

Package source lives under [`editors/vscode/`](../../editors/vscode/).
