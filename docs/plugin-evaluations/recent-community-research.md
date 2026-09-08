# Recent community research

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh-research community"`,
`npm search "deepseek-harness research"`, `npm search "dsh last30days"`,
`npm search "dsh social research"`, scoped variants, the GitHub `dsh-plugin`
topic, the community plugin registry/awesome list, the locked official tree,
and installed official inventory. Downloads cover 2026-08-08 through
2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `dsh-industry-research` | 0.3.5 | Apache-2.0 | 1,815 | 2026-09-07 | github.com/PerryLink/dsh-industry-research |
| `dsh-research-report` | 0.3.6 | Apache-2.0 | not shortlisted | 2026-09-07 | github.com/PerryLink/dsh-research-report |
| `dsh-mimir` | 0.18.1 | MIT | not shortlisted | 2026-09-06 | github.com/pfzimmerman/dsh-mimir |

No hit implements a bounded recent-community/social cross-source outcome.
Report engines and literature workbenches solve different problems.

## Evaluation

The closest domain pack, `dsh-industry-research@0.3.5`, is readable
Apache-2.0 source with SHA-256
`6e74cd35ce1bcfc31419ca3ccd8cb0ad4af1bbfecb7903747536267ffe73ae81`.
It has two runtime build-tool dependencies, four DSH peers on the 0.1.2 line,
a prepare script, filesystem skill registration, and extensive project writes.
Its useful ideas are explicit search/fetch timeouts and traceable sources, but
its project artifact workflow, four tools, and local filesystem authority are
not admissible for this read-only Telegram assistant outcome.

## Probe results

`scripts/dsh-plugin-probe.sh dsh-industry-research --version 0.3.5` ran in a
fresh throwaway home with scripts blocked. **FAIL** during installation because
its graph requires `@deepseek-ai/dsh-system-prompt >=0.1.2 <0.2.0-0`, which is
not satisfiable on locked DSH 0.1.1-rc.2. No package code executed.

## Decision

**Build** a bounded recent-community research contract with a caller-supplied
time window, explicit cancellation/timeout, source timestamps, and a finite
finding set. It must route only through admitted `provider-read` mediation and
must not inherit the candidate's filesystem, skill, report-writing, or shell
surface.
