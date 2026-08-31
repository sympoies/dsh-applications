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

- [Telegram channel](telegram-channel.md) — 2026-09-01 — adopt
  `@ashafizullah/dsh-telegram@0.5.1`
