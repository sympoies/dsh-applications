# Read-only work recommendation mediation

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh work recommendation"`,
`npm search "deepseek-harness task recommendation"`, the GitHub `dsh-plugin`
topic, the curated plugin list, the official locked DSH tree, and installed
official packages. Downloads cover 2026-08-08 through 2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@linxin666/dsh-client-ui-task-board` | 0.3.17 | Apache-2.0 | 245,193 | 2026-09-07 | github.com/zhu1090093659/dsh-web |
| `dsh-personal-workbench` | topic only | unknown | n/a | 2026-09-07 | github.com/Dely0/dsh-personal-workbench |
| `dsh-advisor` | topic only | unknown | n/a | 2026-09-03 | github.com/omdsh-dev/dsh-advisor |

Topic results provide task boards, task mutation, session execution, or a
second-model reviewer. None is a read-only projection from a pre-admitted
organization source.

## Evaluation

The task-board finalist is actively maintained Apache-2.0 source with one
runtime dependency and one peer. Its published manifest requires DSH
`>=0.1.2-rc.1`, while this repository is locked to 0.1.1-rc.2. The exact
tarball SHA-256 is
`2b27034628dd3f9e877ea86cfbdaf44d411617029e6d2258fd8bfc9a4039b89b`.
Reviewed source includes task mutation, permission selection, host paths,
workspace/session IDs, scheduled execution, and a persistent board, which is
substantially wider than a bounded recommendation read.

## Probe results

The disabled composition probe mechanically passed after stripping the
self-registering bundle layer. That does not overcome the declared minimum DSH
version or establish the required read-only organization-source boundary.

## Decision

**Build** a single read action with an opaque admitted source, bounded ranked
recommendations, and no task mutation or execution. The private source adapter
owns board/provider access.

