# Organization calendar mediation

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh calendar"`,
`npm search "deepseek-harness calendar"`, the GitHub `dsh-plugin` topic,
the `awesome-dsh-plugin` curated list, the official DSH tree at locked
revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, and the installed official
package inventory. Downloads are the npm 30-day count for 2026-08-08 through
2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `dsh-calendar` | 0.5.0 | MIT | 2,019 | 2026-09-07 | github.com/STARDUSTLC666/dsh-calendar |
| `@magma27/dsh-calendar` | 0.1.5 | Apache-2.0 | not shortlisted | 2026-09-04 | github.com/MAGMA27/dsh-calendar |
| `@necokeine/dsh-calendar` | 0.1.2 | MIT | not shortlisted | 2026-08-28 | github.com/necokeine/dsh-calendar |

The latter two are task/usage-calendar user interfaces, not mediated access to
an organization calendar. The official tree contains scheduling primitives but
no organization calendar provider boundary.

## Evaluation

`dsh-calendar@0.5.0` is active, MIT licensed, has three runtime dependencies,
no peers, readable compiled source, and no install lifecycle script. The exact
tarball has SHA-256
`4f9d410e9ece1fea25eeafe70cd2af370afdefadd247baf7bb1c5bd845b7573b`.
It is a useful functional comparison for list/create/update/delete schemas, but
the reviewed bytes resolve CalDAV URLs, usernames, passwords, OAuth client
credentials, refresh tokens, and provider identities inside plugin config and
environment variables. That deliberately differs from this repository's
credential-free, deployment-resolved target boundary.

## Probe results

`scripts/dsh-plugin-probe.sh dsh-calendar --version 0.5.0` passed with the
exact DSH 0.1.1-rc.2 launcher: the package installed with scripts blocked,
stayed absent after its self-registering bundle layer was stripped, and mounted
disabled through an explicit insert row.

## Decision

**Build** only provider-neutral request/receipt and descriptor contracts.
Private deployment must resolve one opaque calendar target and credentials
before runtime-kit mediation. No provider client or credential handling is
copied from the candidate.

