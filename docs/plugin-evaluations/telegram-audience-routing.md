# Telegram audience routing

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

The survey reran `npm search "dsh-telegram"`, `npm search "deepseek-harness
telegram"`, and `npm search "@deepseek-ai telegram"` on 2026-09-08. It also
checked the GitHub `dsh-plugin` topic, the current awesome-list results, the
official DSH monorepo at locked revision
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, and the locally installed exact
official package inventory. The official tree and inventory still contain no
Telegram transport or audience router.

Downloads are the npm 30-day totals observed on 2026-09-08 for 2026-08-08
through 2026-09-06. The table keeps the conversational Telegram packages that
were non-trivial for this narrower question: exact conversation admission and
mixed per-chat behavior under one transport identity.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@ashafizullah/dsh-telegram` | 0.5.1 | MIT | 1,359 | 2026-08-21 | github.com/ashafizullah/dsh-telegram |
| `dsh-telegram-multiagent` | 1.5.5 | MIT | 3,090 | 2026-09-04 | github.com/iia-arg/dsh-plugins |
| `dsh-channel-telegram` | 0.5.0 | MIT | 1,345 | 2026-09-06 | github.com/ToxicantX/dsh-channel-telegram |
| `dsh-telegram` | 0.2.0 | MIT | 1,226 | 2026-08-18 | github.com/Gum97/dsh-telegram |
| `@syncended/dsh-messenger` | 0.14.0 | MIT | 3,450 | 2026-09-05 | github.com/syncended/deepseek-harness-messenger |
| `@michengai/dsh-im-connect` | 0.1.37 | Apache-2.0 | 8,123 | 2026-09-07 | github.com/MichengAI/dsh-im-connect |
| `dsh-telegram-bridge` | 0.1.3 | MIT | 694 | 2026-08-16 | github.com/Joycate/dsh-telegram-bridge |
| `@naturalmoods/dsh-telegram-bundle` | 0.1.0-rc.6 | MIT | 285 | 2026-08-13 | github.com/naturalmoods/deepseek-harness |

The topic survey additionally found Telegram front ends distributed only from
GitHub. The current examples accept tokens and raw user allowlists through
environment or install configuration, bind existing interactive sessions, or
run as a separate process. They are useful transports, but none provides an
npm-pinned, fail-closed DSH contract for authenticated opaque audience roles.

## Evaluation

- `@ashafizullah/dsh-telegram@0.5.1` remains the transport finalist. Its exact
  MIT tarball has readable compiled source and source maps, two runtime
  dependencies, no peer dependencies, no install lifecycle script, and the
  reviewed integrity already recorded in [Telegram channel](telegram-channel.md).
  The bytes implement `/new`, `/model`, `/status`, and `/stop`, and group
  addressing recognizes both an explicit mention and a reply to the bot.
  However, access checks only a participant `allowFrom` list and
  `requireMentionInGroups` is one global boolean. There is no exact chat
  admission, opaque authenticated binding, replay guard, or per-chat mention
  policy.
- `dsh-telegram-multiagent@1.5.5` is MIT, current, has no runtime or peer
  dependencies, readable source, and no install script. It fans multiple bot
  identities into agents and uses token-file and raw allowlist configuration.
  That is a different topology from mixed audience behavior under one bot and
  retains the credential and self-mounting concerns in the earlier evaluation.
- `dsh-channel-telegram@0.5.0` is MIT and current, but has five runtime
  dependencies (including QQ and WeChat channels), twelve DSH peers, and now
  requires the DSH 0.1.2 line. It is both broader than the least-authority
  requirement and incompatible with the exact 0.1.1-rc.2 lock.
- The other npm hits remain non-finalists: they either target another DSH
  release line, have broad multi-IM/client dependency surfaces, lack DSH bundle
  metadata, or do not add exact conversation admission and mixed per-chat
  addressing to the adopted transport.

The selected implementation therefore keeps credential resolution and
binding authentication outside the public package. The public router accepts
only an authority owner's authenticated opaque result, checks exact event,
scope, audience, conversation, participant, and binding correspondence,
requires owner-backed single-use consumption, enforces a fixed ambient-context
ceiling, and derives deployment-isolated session and model-route keys. It does
not create another policy engine or retain replay state itself.

## Probe results

Every finalist was probed with `scripts/dsh-plugin-probe.sh`, install scripts
blocked, and an exact published `@deepseek-ai/dsh@0.1.1-rc.2` launcher in a
fresh throwaway `DSH_HOME`.

- `@ashafizullah/dsh-telegram@0.5.1`: PASS — installs, remains absent after
  add-time bundle registration is stripped, and mounts only through an
  explicit disabled insert row.
- `dsh-telegram-multiagent@1.5.5`: PASS — installs, remains absent after its
  self-mounting bundle registration is stripped, and mounts disabled through
  the explicit insert row.
- `dsh-channel-telegram@0.5.0`: FAIL — its peer graph asks for stable
  `@deepseek-ai/dsh-agent >=0.1.2`, which the registry does not publish on the
  locked release-candidate line.

An initial attempt to invoke the locked source checkout failed before a probe
step because that checkout's shared installed dependencies exposed a different
Cordis surface (`FiberState` was absent). That result was not used as candidate
evidence. Reinstalling the exact published launcher in the throwaway evidence
area produced the clean PASS/FAIL results above.

## Decision

**Build the missing public audience admission and routing contract while
continuing to adopt `@ashafizullah/dsh-telegram@0.5.1` unchanged as the exact
transport.** No surveyed candidate combines exact conversation admission,
separate participant authorization, authenticated opaque deployment bindings,
single-use replay rejection, mixed mention/free-response groups, bounded
ambient context, and isolated session/model-route dispatch under one bot.

The new contract remains non-authorizing: a private deployment and runtime-kit
owner authenticate and atomically consume the binding, choose a public
model-route class, and may narrow every bound. The public package validates the
returned document and derives only opaque dispatch keys. Raw Telegram
identifiers, credential handles, provider endpoints, mutable replay state, and
deployment topology remain outside this repository.

Media, vision, and Telegram location parity are intentionally not borrowed or
enabled here. They require their own authority review and are tracked by
[issue #28](https://github.com/sympoies/dsh-applications/issues/28).
