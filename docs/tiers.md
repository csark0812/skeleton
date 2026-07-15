# Tiers

**Source of truth for** the three-tier agent ecosystem.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

| Repo | Role |
|------|------|
| **skeleton** | Single source of truth (SSOT) audit CLI |
| **toolbox** | Team skills + public agent preferences |
| **personal-toolbox** | Private skills + personal preferences |
| **Consumer apps** | Call skeleton for SSOT; keep code validation local |

Skeleton never calls Nx or other task runners — consumers call skeleton for SSOT paths.

See [getting started](developer/getting-started.md), [install](developer/install.md), and [validation](developer/validation.md).
