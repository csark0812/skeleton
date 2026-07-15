# Skeleton for VS Code

VS Code diagnostics for the
[`@csark0812/skeleton`](https://www.npmjs.com/package/@csark0812/skeleton) SSOT audit CLI.

## Requirements

Install Skeleton in the workspace:

```sh
npm install --save-dev @csark0812/skeleton
```

The extension resolves `node_modules/.bin/skeleton` first. Set `skeleton.path` to an absolute
executable path when the CLI is installed elsewhere.

## Features

- Problems-panel diagnostics and editor squiggles for Markdown audit issues
- Path-scoped audits when Markdown files open or save
- Workspace audits when Skeleton configuration, registry, or policy YAML changes
- Commands to audit the current file or workspace
- Quick fixes backed by Skeleton's existing doc-meta and anchor fixers

## Development

```sh
npm install
npm run check
npm run build
npm run package
```

Press `F5` from this directory in VS Code to launch an Extension Development Host.
