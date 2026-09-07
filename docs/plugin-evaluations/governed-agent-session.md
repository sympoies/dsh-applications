# Governed agent-session mediation

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: reference

## Survey

Queries run on 2026-09-07/08: `npm search "dsh agent session"`, the GitHub
`dsh-plugin` topic, the curated plugin list, the official DSH monorepo at
locked revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, and installed
official packages. Downloads are the npm 30-day count for 2026-08-08 through
2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `@deepseek-ai/dsh-agent` | 0.1.1-rc.2 | MIT | 2,221,428 | 2026-08-26 | github.com/deepseek-ai/deepseek-harness |
| `@deepseek-ai/dsh-session` | 0.1.1-rc.2 | MIT | official dependency | 2026-08-26 | github.com/deepseek-ai/deepseek-harness |
| `@deepseek-ai/dsh-workspace` | 0.1.1-rc.2 | MIT | official dependency | 2026-08-26 | github.com/deepseek-ai/deepseek-harness |

The same locked official line supplies user approval, timeout, sandbox policy,
session persistence, and agent cancellation. Community task coordinators and
session managers add orchestration/UI or broad shell authority rather than the
thin mediated channel boundary required here.

## Evaluation

The exact `@deepseek-ai/dsh-agent@0.1.1-rc.2` tarball is readable MIT source,
has no install scripts, seven peers, npm integrity
`sha512-cC7lnJe7JgPFcreNXxcxLMxQd78LnpVO9ZXROjZsGRQN1zGH6i/DduI892F1am85IfzzO+XTxMwwUHmfwamb0g==`,
and SHA-256
`3cfd33897ed857c50ddb4d0b4e33435fa5e64ab475a0f4932a19ebe589b057eb`.
Its public factory owns create/resume handles; the agent owns inbox/continue and
cancellation; session persistence owns restart truth. Runtime-kit already owns
target-scope assertions, idempotency, lifecycle fencing, and host receipts.

## Probe results

The generic external-plugin probe installed the exact agent package with build
scripts blocked, then reported it present before an insert row. This is expected
and not an adoption failure: `dsh-base` already composes the official agent
primitive at the locked version, so the probe cannot treat it as an independent
optional plugin row.

## Decision

**Reference** the official DSH agent/session/workspace/approval/timeout
semantics. Add only distinct public mediated action schemas for create, status,
metadata attachment, continue, and cancel. Do not copy official source, create
a second agent loop/session store, accept a raw host path, or expose shell.
