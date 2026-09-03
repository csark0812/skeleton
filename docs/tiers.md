# Tiers

<!-- source-of-truth: the three-tier agent ecosystem -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-02 -->

<!-- review-deps: paths=docs/developer/getting-started.md,docs/developer/install.md,docs/developer/validation.md -->

Map of the three-tier agent ecosystem across skeleton, toolbox, and consumer apps.

| Repo | Role |
|------|------|
| **skeleton** | Single source of truth (SSOT) audit CLI |
| **toolbox** | Team skills + public agent preferences |
| **personal-toolbox** | Private skills + personal preferences |
| **Consumer apps** | Call skeleton for SSOT; keep code validation local |

Skeleton never calls Nx or other task runners — consumers call skeleton for SSOT paths.

See [getting started](developer/getting-started.md), [install](developer/install.md), and [validation](developer/validation.md).
