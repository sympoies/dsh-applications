# Telegram channel

- Date: 2026-09-07
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: adopt

## Survey

Queries rerun on 2026-09-07: `npm search "dsh-telegram"`,
`npm search "deepseek-harness telegram"`, `npm search "@deepseek-ai telegram"`;
the GitHub `dsh-plugin` topic; the `awesome-dsh-plugin` curated list; the
official DSH monorepo at locked revision
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; and the locally installed
official package inventory. Downloads are the npm 30-day totals observed on
2026-09-07 for 2026-08-08 through 2026-09-06.

The locked official DSH tree and installed official package inventory contain
no Telegram channel. The curated list now includes many Telegram or multi-IM
projects; the table keeps every non-trivial npm-published hit whose declared
scope includes two-way Telegram conversations rather than notification-only
delivery.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@ashafizullah/dsh-telegram` | 0.5.1 | MIT | 1,359 | 2026-08-21 | github.com/ashafizullah/dsh-telegram |
| `dsh-telegram-multiagent` | 1.5.5 | MIT | 3,090 | 2026-09-04 | github.com/iia-arg/dsh-plugins |
| `dsh-telegram` | 0.2.0 | MIT | 1,226 | 2026-08-18 | github.com/Gum97/dsh-telegram |
| `dsh-channel-telegram` | 0.4.2 | MIT | 1,345 | 2026-09-06 | github.com/ToxicantX/dsh-channel-telegram |
| `@syncended/dsh-messenger` | 0.14.0 | MIT | 3,450 | 2026-09-05 | github.com/syncended/deepseek-harness-messenger |
| `@michengai/dsh-im-connect` | 0.1.36 | Apache-2.0 | 8,123 | 2026-09-07 | github.com/MichengAI/dsh-im-connect |
| `dsh-telegram-bridge` | 0.1.3 | MIT | 694 | 2026-08-16 | github.com/Joycate/dsh-telegram-bridge |
| `@naturalmoods/dsh-telegram-bundle` | 0.1.0-rc.6 | MIT | 285 | 2026-08-13 | github.com/naturalmoods/deepseek-harness |

`@luzhengyangtx/dsh-telegram-duty` remains a duty/approval gateway rather
than the general conversational ingress under evaluation. Notification-only
packages are likewise out of scope.

## Evaluation

- `@ashafizullah/dsh-telegram` 0.5.1 — finalist. MIT, published and tagged
  within 90 days; repository exists. Two runtime dependencies
  (`@deepseek-ai/cordis`, `@deepseek-ai/schemastery`), no peers, no install
  lifecycle script, and readable compiled source plus source maps in the exact
  published tarball. The reviewed bytes have npm integrity
  `sha512-/bFEveB+vafAFoM2MW6vTCTPEHBMDnblAfKaFIs221Jh27cvfFrtHyhwi5vzxByqeoqMN/g/2I23+gI4NU1lLg==`,
  tarball SHA-256
  `a41aa5300eb0b0a25b33c162e843955eac8450c8a71446ba5c7f68623b61ea4b`,
  source revision `596ef74b4fb9536aaae9981035240be4ef8a9acd`, and an npm
  SLSA provenance attestation. Configuration carries a `tokenRef`; the token
  value is resolved from DSH's credential service. The public composition must
  therefore omit the reference and remain disabled until private admission
  supplies the credential and access binding.
- `dsh-telegram-multiagent` 1.5.5 — finalist and fallback. MIT, actively
  maintained, zero runtime and peer dependencies, readable source and tests,
  and no install script. It still declares a token file per agent and ships a
  self-enabling patch layer, so its credential and activation posture does not
  fit the public/private boundary without downstream rework.
- `dsh-telegram` 0.2.0 and `@naturalmoods/dsh-telegram-bundle`
  0.1.0-rc.6 — rejected for the locked DSH line. Their resolved plugin graphs
  request stable `>=0.1.1` DSH peer versions that do not exist for packages
  still published only as prereleases; the exact locked profile cannot install
  them.
- `dsh-channel-telegram` 0.4.2 — not shortlisted. Five runtime dependencies,
  twelve DSH peers, and bundled QQ/WeChat transports exceed the single-channel
  authority and dependency surface needed here.
- `@syncended/dsh-messenger` 0.14.0 and `@michengai/dsh-im-connect` 0.1.36 —
  not shortlisted. Both target the DSH 0.1.2 release-candidate line; the former
  declares twenty DSH/React peers, while the latter adds five multi-IM runtime
  SDKs and broad client/server peers. Neither is a least-authority fit for the
  current exact lock.
- `dsh-telegram-bridge` 0.1.3 — not shortlisted. Its published manifest has
  no DSH bundle metadata, so the DSH plugin probe cannot establish the required
  composition contract.

## Probe results

`scripts/dsh-plugin-probe.sh <pkg> --version <ver> --dsh-bin <exact locked
launcher>` was run in a fresh throwaway `DSH_HOME`. The launcher itself was
installed at exact version 0.1.1-rc.2; each probe also installed exact
`@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-headless` 0.1.1-rc.2 with build
scripts blocked.

- `@ashafizullah/dsh-telegram@0.5.1`: PASS — installs, stays absent after its
  add-time bundle registration is stripped, and mounts through an explicit
  insert row with `disabled: true`. Its shipped patch requires only the
  `agents` and `credentials` services.
- `dsh-telegram-multiagent@1.5.5`: PASS — installs, stays absent after its
  add-time bundle registration is stripped, and mounts disabled through the
  explicit insert row. It still ships its own self-mounting patch layer.
- `dsh-telegram@0.2.0`: FAIL — `ERR_PNPM_NO_MATCHING_VERSION` for
  `@deepseek-ai/dsh-llm@>=0.1.1 <0.2.0` while the official package remains on
  prerelease versions.
- The prior 2026-09-01 probe of
  `@naturalmoods/dsh-telegram-bundle@0.1.0-rc.6` failed in the same
  unresolvable-peer class; its version and compatibility declarations are
  unchanged, so it was not rerun.

The ambient `dsh` executable was 0.1.0-rc.7 and rejected the probe command
shape. It was not used as evidence; every result above came from the exact
0.1.1-rc.2 launcher named with `--dsh-bin`.

## Decision

**Continue to adopt `@ashafizullah/dsh-telegram`, pinned to exact version
0.5.1 and the reviewed published artifact identity.** Mount it only through an
explicit `insert` patch row with `disabled: true`; never accept its add-time
bundle registration as governed activation. The public Telegram composition
may declare only the channel's bounded mediation and its dependency on
`conversation.memory` and `conversation.reply`. Credential references, access
identifiers, host configuration, enablement, ingress ownership, and rollout
remain private admission and deployment concerns. Its broader optional media,
OCR, and screen-capture surfaces are fixed off by the public defaults and are
outside this adopted contract.

`dsh-telegram-multiagent@1.5.5` remains the recorded fallback if multi-agent
fan-in becomes a requirement, at the cost of replacing its token-file and
self-enabling defaults.
