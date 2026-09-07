# Plugin evaluations

Records produced by the `evaluate-dsh-plugin` skill
(`.agents/skills/evaluate-dsh-plugin/SKILL.md`). One file per capability
topic; each record ends in exactly one decision: **adopt**, **reference**,
or **build**. A decision to build without a record here is a process
violation: the survey is the proof that the wheel does not already exist.

## Record template

```markdown
# <Capability topic>

- Date: YYYY-MM-DD
- Author: <role or handle>
- Decision: adopt | reference | build

## Survey

| Package | Version | License | Downloads/mo (date) | Last publish | Repository |
| ------- | ------- | ------- | ------------------- | ------------ | ---------- |

## Evaluation

Criteria scores per shortlisted candidate: license, maintenance,
dependency surface, security (readable tarball, no install scripts,
no credential handling), contract fit.

## Probe results

Output of scripts/dsh-plugin-probe.sh per finalist (exact version probed).

## Decision

The single decision with its rationale, what is adopted or borrowed, and
follow-ups.
```

## Index

- [Organization calendar mediation](organization-calendar.md) — 2026-09-08 — build
- [Conversation-scoped group notes mediation](conversation-group-notes.md) — 2026-09-08 — build
- [Read-only work recommendation mediation](work-recommendation.md) — 2026-09-08 — build
- [Governed agent-session mediation](governed-agent-session.md) — 2026-09-08 — reference
- [External agent-memory mediation](external-agent-memory.md) — 2026-09-08 — build
- [Telegram audience routing](telegram-audience-routing.md) — 2026-09-08 — build
  a public admission and routing contract beside the adopted transport
- [Telegram channel](telegram-channel.md) — 2026-09-07 — adopt
  `@ashafizullah/dsh-telegram@0.5.1`
