# Weather lookup

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh-weather"`,
`npm search "deepseek-harness weather"`, scoped variants, the GitHub
`dsh-plugin` topic, the community plugin registry/awesome list, the locked
official DSH tree at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, and the
installed official package inventory. Downloads are npm's 30-day total for
2026-08-08 through 2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `dsh-weather` | 0.1.0 | MIT | 306 | 2026-08-14 | github.com/sunshine-lang/dsh-weather |
| `@dennisrongo/dsh-weather` | 0.4.0 | MIT | not shortlisted | 2026-09-01 | github.com/dennisrongo/dsh-plugins |
| `dsh-weather-plugin` | 1.0.0 | MIT | not shortlisted | 2026-08-16 | no repository declared |

The latter two are Web UI/theme surfaces rather than a model-callable,
deployment-independent weather result contract. The official DSH tree has no
weather capability.

## Evaluation

`dsh-weather@0.1.0` is the only close functional candidate. The exact npm
tarball is readable compiled JavaScript, contains no install lifecycle script,
has three runtime dependencies, and has SHA-256
`5e1aa4e5dd259a9c6415abe8fae4d35d399ff74558e989131d974e6ed2f44f64`.
It directly fetches Open-Meteo and self-mounts enabled, while its public result
does not bind a generic implementation identity, deployment audience,
freshness receipt, output-byte ceiling, or independent admission. Those gaps
prevent adoption for this contract even though the provider itself requires no
credential.

## Probe results

`scripts/dsh-plugin-probe.sh dsh-weather --version 0.1.0` ran with the exact
DSH 0.1.1-rc.2 launcher in a fresh throwaway `DSH_HOME`, with dependency build
scripts blocked. **PASS**: after its add-time bundle registration was removed,
the package stayed absent without an explicit row and mounted with
`disabled: true` through the probe insert row.

## Decision

**Build** the stable public weather contract. Private implementations may use
Open-Meteo or another admitted source behind a `provider-read` broker, but the
public contract will not adopt the candidate's client, self-enabling patch, or
provider binding.
