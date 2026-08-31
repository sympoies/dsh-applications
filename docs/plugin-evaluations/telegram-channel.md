# Telegram channel

- Date: 2026-09-01
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: adopt

## Survey

Queries: `npm search "dsh telegram"`, `npm search "dsh channel"`,
`npm search "deepseek-harness telegram"`; GitHub `dsh-plugin` topic;
`awesome-dsh-plugin`. Downloads observed 2026-09-01 for the 30 days ending
2026-08-29.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@ashafizullah/dsh-telegram` | 0.5.1 | MIT | 1270 | 2026-08-21 | github.com/ashafizullah/dsh-telegram |
| `dsh-telegram-multiagent` | 1.3.0 | MIT | 1352 | 2026-08-23 | github.com/iia-arg/dsh-plugins |
| `dsh-telegram` | 0.2.0 | MIT | 855 | 2026-08-18 | github.com/Gum97/dsh-telegram |
| `dsh-channel-telegram` | 0.4.2 | MIT | 831 | 2026-08-30 | github.com/ToxicantX/dsh-channel-telegram |
| `@naturalmoods/dsh-telegram-bundle` | 0.1.0-rc.6 | MIT | 269 | 2026-08-13 | github.com/naturalmoods/deepseek-harness |
| `@luzhengyangtx/dsh-telegram-duty` | 0.4.0 | MIT | n/a | 2026-08 | (duty-gateway niche; out of scope) |

No LINE channel plugin exists (only the name-reserved empty package
`dsh-line 0.0.1`); LINE remains a genuine gap for a later record.

## Evaluation

- `@ashafizullah/dsh-telegram` 0.5.1 — finalist. Small dependency surface
  (`@deepseek-ai/cordis`, `@deepseek-ai/schemastery`; no peers). Readable
  published source (`lib/` with maps and `.d.ts`). No install scripts. Best
  credential design of the field: configuration carries a `tokenRef` and the
  bot token lives in the harness credential seam (`inject: [agents,
  credentials]` in its shipped patch layer); a dedicated module routes every
  outbound text through one place so the token cannot leak through error
  paths. Supports answering agent questions/approvals from chat.
- `dsh-telegram-multiagent` 1.3.0 — finalist. Zero runtime dependencies,
  readable `src/` + `test/` in the tarball, no install scripts. Multi-agent
  fan-in with sender marks. Two cautions: its shipped patch layer mounts
  itself **enabled** with a `tokenFile` path config (file-based token, not
  the credential seam), and `dsh plugin add` bundle-registers it, so an
  unstripped add activates it immediately.
- `dsh-telegram` 0.2.0 — rejected: peer range `@deepseek-ai/dsh-agent
  >=0.1.1 <1.0.0` cannot resolve against the locked prerelease DSH
  (0.1.1-rc.2); install fails.
- `@naturalmoods/dsh-telegram-bundle` 0.1.0-rc.6 — rejected: same
  unresolvable-peer class (`@deepseek-ai/dsh-llm`).
- `dsh-channel-telegram` 0.4.2 — not shortlisted: 12 peer dependencies and a
  QQ/WeChat multi-transport scope far beyond the capability under
  evaluation.

## Probe results

`scripts/dsh-plugin-probe.sh <pkg> --version <ver>` against the locked DSH
0.1.1-rc.2 bundles, 2026-09-01:

- `dsh-telegram-multiagent@1.3.0`: PASS — installs with build scripts
  blocked, stays out of the composed tree once the add-time bundle
  registration is stripped, mounts `disabled: true` via the insert row.
  OBSERVATION reported: ships its own patch layer (self-mounting when
  bundle-registered).
- `@ashafizullah/dsh-telegram@0.5.1`: PASS — same posture; OBSERVATION
  reported: ships its own patch layer (insert row requiring the `agents`
  and `credentials` services).
- `dsh-telegram@0.2.0`: FAIL — `ERR_PNPM_NO_MATCHING_VERSION` on its
  dsh-agent peer range.
- `@naturalmoods/dsh-telegram-bundle@0.1.0-rc.6`: FAIL — same class on
  dsh-llm.

## Decision

**Adopt `@ashafizullah/dsh-telegram`, pinned to exact version 0.5.1,**
mounted through an explicit `insert` patch row in a governed profile (never
through the add-time bundle auto-registration). It is the only candidate
whose credential design matches this platform's boundary: the plugin holds a
credential *reference* while the token value stays in the harness credential
seam, which the private deployment layer provisions. `dsh-telegram-multiagent`
is the recorded fallback if multi-agent fan-in becomes a requirement, at the
cost of reworking its file-based token handling.

Follow-ups:

- Public: a conversational Telegram profile in this repository composing the
  adopted plugin with the least-authority conversation contract (no tools;
  session memory only), version-pinned and mounted disabled until admitted.
- Private (sympoies-infra): ingress/credential binding — Telegram bot token
  provisioned into the harness credential seam, deployment identity, and
  rollout.
- LINE channel: no ecosystem candidate exists; a future record will decide
  reference-vs-build using the adopted plugin's structure as the reference
  skeleton.
