# External agent-memory mediation

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-08: `npm search "dsh agent memory"`,
`npm search "deepseek-harness memory"`, the GitHub `dsh-plugin` topic,
the curated plugin list, and the official locked DSH tree. Downloads cover
2026-08-08 through 2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `dsh-agent-memory` | 0.8.4 | MIT | 1,089 | 2026-08-17 | github.com/Culeot/dsh-agent-memory |
| `@rrrrrredy/dsh-agent-memory` | 0.1.0 | MIT | not shortlisted | 2026-08-18 | npm registry |
| `dsh-memory-eternal` | 0.7.0 | MIT | not shortlisted | 2026-08-30 | npm registry |

The candidates own their own local memory databases/files, automatic capture,
model-facing remember/forget operations, or UI. The required outcome instead
mediates an already-existing external private store and permits only recall and
candidate proposal.

## Evaluation

`dsh-agent-memory@0.8.4` has readable MIT source, no install script, no runtime
dependencies, and eleven peer dependencies spanning storage, tools, LLM, and
Web UI. Its exact tarball has SHA-256
`9e507adbeab9ce817d7eac64e2a9af5cdeb614be25790fe73f0d860cd04eba45`.
Its broad remember/index/forget/store ownership is not a fit for an opaque
external target where proposals cannot directly mutate retained memory.

## Probe results

`scripts/dsh-plugin-probe.sh dsh-agent-memory --version 0.8.4` failed during
installation against locked DSH 0.1.1-rc.2 because the resolved stable
`@deepseek-ai/dsh-llm >=0.1.1 <0.2.0-0` range is unavailable.

## Decision

**Build** only two separately mediated actions: bounded read-only recall and an
idempotent candidate-add proposal. The private store remains authoritative for
review, acceptance, persistence, and deduplication. No mutable assistant-session
memory or retained data is copied or migrated.
