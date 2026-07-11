# Tiers

**Source of truth for** the three-tier agent harness ecosystem.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

| Repo | Role |
|------|------|
| **skeleton** | SSOT audit CLI + validation harness |
| **toolbox** | Team skills + public agent preferences |
| **personal-toolbox** | Private skills + personal preferences |
| **Consumer apps** | Call skeleton; keep code validation local |

Skeleton never calls Nx or other task runners — consumers call skeleton for SSOT paths.

See [install](developer/install.md) and [validation](developer/validation.md).
