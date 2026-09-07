# Market and exchange-rate lookup

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh-market exchange"`,
`npm search "deepseek-harness market"`, `npm search "dsh finance"`,
`npm search "dsh exchange rate"`, scoped variants, the GitHub `dsh-plugin`
topic, the community plugin registry/awesome list, the locked official tree,
and installed official inventory. Downloads cover 2026-08-08 through
2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@dsh-sparkles/dsh-sparkles` | 0.1.12 | Apache-2.0 | 814 | 2026-09-07 | github.com/kaiwu/sparkles |
| `dsh-stock-watch` | 1.1.0 | MIT | 3,235 | 2026-08-27 | github.com/Awu12277/dsh-stock-watch |
| `dsh-finance` | 0.0.1 | MIT | 195 | 2026-08-19 | reserved/in development |

`dsh-stock-watch` is an A-share Web UI widget, not a portable quote and
exchange-rate interface. `dsh-finance` declares that its first functional
release is still in development. The official tree has no market domain.

## Evaluation

The exact Sparkles tarball is Apache-2.0 and actively maintained, but it is an
11.3 MB compiled aggregate with 135 finance tools, two runtime dependencies
(including native canvas), ten DSH/Web peer dependencies pinned to 0.1.2-rc.1,
and direct host-environment credential reads. Its SHA-256 is
`bcfe3deba618e7e2cc787e907d1b85e381d8022b41820793d3dcf1b2ae1d98a6`.
Its shell/browser aggregate and credential surface are incompatible with a
single read-only, provider-neutral contract.

## Probe results

`scripts/dsh-plugin-probe.sh @dsh-sparkles/dsh-sparkles --version 0.1.12`
ran in a fresh throwaway home against DSH 0.1.1-rc.2 with scripts blocked.
**FAIL** during candidate installation: its graph requires
`@deepseek-ai/dsh-subagent >=0.1.2 <0.2.0-0`, which has no stable version that
satisfies the range on the locked line. No candidate code executed.

## Decision

**Build** a narrow quote/exchange lookup contract with bounded public result
types and freshness/source evidence. Trading, portfolio state, alerts, shell,
browser automation, provider credentials, and host environment access remain
outside it.
