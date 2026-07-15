# Editor extension

**Source of truth for** installing and using the Skeleton VS Code / Cursor extension.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

The extension surfaces Skeleton audit issues in the editor Problems panel and as squiggles on Markdown files. It shells out to the same `skeleton` CLI binaries — no duplicate audit logic. Suite choice still follows the [validation](validation.md) split (`docs` vs `skills` vs `self`); path-scoped skill edits do not replace a bare `audit skills` prove for global skill-index rules.

Works in **VS Code** and **Cursor** (both use the same extension format).

## Prerequisites

1. Skeleton CLI installed in the workspace:

   ```bash
   npm install -D @csark0812/skeleton
   npx skeleton init
   ```

2. A `.skeleton/config.yaml` in the workspace root (created by `init`).

The extension resolves the CLI as:

1. `skeleton.path` workspace setting (absolute path), if set
2. `node_modules/.bin/skeleton` in the workspace
3. `npx --no-install skeleton`

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

When the workspace does not have `node_modules/.bin/skeleton` — for example while developing Skeleton itself — set an absolute path in workspace settings:

```json
{
  "skeleton.path": "/absolute/path/to/skeleton/dist/cli.js"
}
```

Build the CLI first: `bun run build` (from the skeleton repo root).

## Use

Open a skeleton-enabled workspace. The extension activates when `.skeleton/config.yaml` exists or when you open Markdown.

| Trigger                                              | Behavior                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Open / save docs `.md` / `.mdc`                      | Path-scoped `audit docs --paths=<file> --json`                         |
| Open / save skill-tree Markdown (`SKILL.md`, etc.)   | Path-scoped `audit skills --paths=<file> --json`                       |
| Change `.skeleton/config.yaml` or registry           | `audit self --json`                                                    |
| Change plugin policy YAML under `.skeleton/plugins/` | Full `audit docs` **and** `audit skills` (merged)                      |
| **Skeleton: Audit Current File**                     | Re-run the matching suite for the active file                          |
| **Skeleton: Audit Workspace**                        | `audit self` **and** bare `audit skills` (covers excluded skill trees) |
| **Skeleton: Show Output**                            | CLI command log and parse errors                                       |

Diagnostics appear in **Problems**. Supported quick fixes call existing CLI fixers (`--fix=doc-meta`, `--fix=anchors`).

Settings:

| Setting              | Default | Purpose                                  |
| -------------------- | ------- | ---------------------------------------- |
| `skeleton.path`      | `""`    | Absolute path to the skeleton executable |
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
