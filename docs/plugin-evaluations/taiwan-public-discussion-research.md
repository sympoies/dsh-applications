# Taiwan-focused public-discussion research

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh-taiwan research"`,
`npm search "deepseek-harness taiwan"`,
`npm search "dsh taiwan public discussion"`, `npm search "dsh ptt"`, scoped
variants, the GitHub `dsh-plugin` topic, the community plugin registry/awesome
list, the locked official tree, and installed official inventory. Downloads
cover 2026-08-08 through 2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@deepseek-ai/dsh-web` | 0.1.1-rc.2 | MIT | 1,548,229 | 2026-08-21 | github.com/deepseek-ai/deepseek-harness |
| `dsh-industry-research` | 0.3.5 | Apache-2.0 | 1,815 | 2026-09-07 | github.com/PerryLink/dsh-industry-research |

The `dsh-ptt` search hit is a push-to-talk voice plugin; it is unrelated to the
PTT discussion service. No registry, topic, curated-list, official-tree, or
installed-inventory result provides a Taiwan public-discussion research
contract.

## Evaluation

The official Web seam is a suitable generic provider vocabulary but has no
Taiwan locale, source-class diversity, Traditional Chinese query, discussion
window, or trend output contract. The exact industry-research bytes were also
reviewed for research patterns, but the package targets the wrong DSH line and
requires filesystem writes. Exact-byte and dependency findings are recorded in
the companion Web and recent-community evaluations.

## Probe results

The two closest substrates were probed once at their exact versions in fresh
throwaway homes with scripts blocked:

- `@deepseek-ai/dsh-web@0.1.1-rc.2`: installation succeeded; the probe reported
  it already composed by `dsh-base`, not independently selectable.
- `dsh-industry-research@0.3.5`: installation failed on an unsatisfied 0.1.2
  DSH peer before any candidate code executed.

There was no Taiwan-specific candidate to enable or call.

## Decision

**Build** a locale-specific but organization-neutral public contract. It will
require an explicit Taiwan locale, bounded recent window, source timestamps and
source classes, cancellation, and a finite trend/finding result. Provider and
site identities remain private implementation bindings; filesystem, shell,
credential, and ambient-network authority are excluded.
