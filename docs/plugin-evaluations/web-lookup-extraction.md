# Ordinary web lookup and extraction

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: reference

## Survey

Queries run on 2026-09-07/08: `npm search "dsh-web extraction"`,
`npm search "deepseek-harness web search"`, scoped variants, the GitHub
`dsh-plugin` topic, the community plugin registry/awesome list, the locked
official Web family, and installed official inventory. Downloads cover
2026-08-08 through 2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@deepseek-ai/dsh-web` | 0.1.1-rc.2 | MIT | 1,548,229 | 2026-08-21 | github.com/deepseek-ai/deepseek-harness |
| `@deepseek-ai/dsh-tool-web` | 0.1.1-rc.2 | MIT | 1,531,334 | 2026-08-21 | github.com/deepseek-ai/deepseek-harness |
| `dsh-web-degoog` | 0.3.1 | MIT | 836 | 2026-08-25 | github.com/shantanugoel/dsh-web-degoog |

The official Web family owns provider selection plus search/fetch request and
result vocabulary. Community providers are implementation choices rather than
the portable contract required here.

## Evaluation

The exact official Web and tool tarballs are readable, have no install scripts,
and match the locked DSH line. Their SHA-256 values are respectively
`aa8f3e95732632c37e9215bce8fc3a268bdca4b3bc5da6e7d6a34b39efc02ec3` and
`6c970ef2320389ba035534c8584dff807dff74059c10d83333ef5e9b01b09e14`.
They provide useful cancellation (`AbortSignal`), structured citations,
fetch-result, and bounded presentation patterns. They do not bind the
runtime-kit admission, audience, exact implementation identity, or public
output schema required by this application layer.

`dsh-web-degoog@0.3.1` is readable MIT code with no install script and SHA-256
`a1ab11155c29c863c82ddbf263c7dbfdc061cc148e16c197bf7024f134dd2542`.
It properly blocks private/loopback fetch by default, but selects a concrete
server and credential reference and self-mounts a provider, so it cannot be the
public implementation-neutral contract.

## Probe results

- `@deepseek-ai/dsh-web@0.1.1-rc.2` and
  `@deepseek-ai/dsh-tool-web@0.1.1-rc.2`: dependency installation succeeded
  with scripts blocked; the generic probe reported each already present before
  its insert row because the exact `dsh-base` bundle composes both official
  packages.
- `dsh-web-degoog@0.3.1`: **PASS** after its self-registering bundle layer was
  removed; it stayed absent without an insert row and mounted disabled with the
  explicit row in a throwaway `DSH_HOME`.

No network provider was enabled or called by any probe.

## Decision

**Reference** the exact official Web seam's search/fetch result shapes,
cancellation, and source handling while building the runtime-kit-mediated
public contract. Do not copy source or adopt a provider. Private admission
chooses the implementation and binding; public defaults remain disabled and
have no credential, filesystem, subprocess, or ambient network access.
