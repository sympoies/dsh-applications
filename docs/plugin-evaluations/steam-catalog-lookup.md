# Steam catalog and price lookup

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh-steam"`,
`npm search "deepseek-harness steam"`, `npm search "dsh steam price"`,
`npm search "dsh game price"`, scoped variants, the GitHub `dsh-plugin`
topic, the community plugin registry/awesome list, the locked official tree,
and installed official inventory. Downloads cover 2026-08-08 through
2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `steam-user` | 5.3.0 | MIT | 69,764 | 2025-12-04 | github.com/DoctorMcKay/node-steam-user |
| `@deepseek-ai/dsh-web` | 0.1.1-rc.2 | MIT | 1,548,229 | 2026-08-21 | github.com/deepseek-ai/deepseek-harness |

No npm, topic, curated-list, official-tree, or installed-inventory hit provides
a DSH Steam catalog/price lookup. `steam-user` is a general authenticated Steam
client with account and trading surfaces, not a DSH plugin or read-only catalog
contract. The official Web seam is the closest provider-neutral substrate.

## Evaluation

The exact official Web tarball is readable, has no install script, one runtime
dependency and three peers, and SHA-256
`aa8f3e95732632c37e9215bce8fc3a268bdca4b3bc5da6e7d6a34b39efc02ec3`.
It supplies generic search/fetch vocabulary, not Steam-specific catalog,
regional price, discount, currency, or freshness schemas. `steam-user` was not
shortlisted for probing because its authenticated account protocol is a larger
and riskier authority class than the requested public catalog lookup.

## Probe results

The closest DSH substrate was probed with
`scripts/dsh-plugin-probe.sh @deepseek-ai/dsh-web --version 0.1.1-rc.2` in a
fresh throwaway home. Dependency installation succeeded with scripts blocked.
The generic probe then **FAILed closed intentionally** because `dsh-base`
already composes that official seam, so it was present before the probe's
explicit insert row. This proves it is not a separately selectable Steam
contract; no provider request ran.

## Decision

**Build** a Steam-specific public catalog/price contract over a private
`provider-read` implementation slot. Do not adopt authenticated Steam account,
inventory, purchase, or trading APIs, and do not treat the precomposed generic
Web seam as Steam authority.
