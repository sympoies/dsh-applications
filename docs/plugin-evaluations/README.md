# Plugin evaluations

Before building a new DSH capability, survey the existing ecosystem and record
an **adopt**, **reference**, or **build** decision here, one file per concrete
capability topic. A build decision requires a recorded survey.

Run probes only in a throwaway DSH_HOME. Never approve dependency build scripts,
enable a third-party plugin, or modify a real profile during evaluation. Registry
statistics need an observation date; borrowed source needs a license/provenance
check. This procedure does not publish, deploy, or grant authority.

The probe exits 0 for a successful install/compose/disabled mount, 1 for a failed
step, and 2 for an argument or environment error. Record failures in the evaluation.

## Evaluation procedure

### 1. Survey

Run fixed queries and keep every non-trivial hit:

- npm: `npm search "dsh-<topic>"`, `npm search "deepseek-harness <topic>"`,
  plus scoped variants; `npm view <pkg>` for version history, license,
  repository, maintainers; `https://api.npmjs.org/downloads/point/last-month/<pkg>`
  for adoption.
- GitHub: the `dsh-plugin` topic and the `awesome-dsh-plugin` curated list.
- Local: the installed inventory under a DSH_HOME `node_modules/@deepseek-ai/`
  and the upstream monorepo checkout, for capabilities that may already ship
  officially.

### 2. Evaluate

Score each shortlisted candidate against the fixed criteria:

- **License**: MIT/Apache-class required for adopt or reference; no license
  means inspiration only.
- **Maintenance**: published or committed within the last 90 days; repository
  exists and issues get responses.
- **Dependency surface**: fewer runtime and peer dependencies is better;
  record the full peer list.
- **Security**: published tarball contains readable source (`npm pack`, or
  read it in the probe's `node_modules`); no install scripts (a candidate
  needing build scripts to compose is a red flag); no credential handling
  inside the plugin - credentials belong to the private infrastructure layer.
- **Contract fit**: passes `scripts/dsh-plugin-probe.sh` (installs against
  the locked DSH version, absent from the composed tree until an `insert`
  row mounts it, mounts `disabled: true`); its grants can be expressed in a
  least-authority profile of this repository.

Review the exact published bytes, not only the GitHub repository: the two
can differ.

### 3. Probe

For each finalist run the repository probe from the worktree root:

```sh
scripts/dsh-plugin-probe.sh <package> --version <exact-version>
```

`--dry-run` renders the probe profile and plan without network or a dsh
launcher; the live run needs `dsh` on PATH or `--dsh-bin`. The probe always
sets `DSH_HOME` to its own throwaway workdir and never touches a real
profile.

### 4. Decide and record

Write `docs/plugin-evaluations/<topic-slug>.md` with the survey table,
criteria scores, probe results, and exactly one decision:

- **adopt**: use the candidate, pinned to an exact version, mounted via an
  `insert` patch row; record the reviewed tarball version.
- **reference**: build our own governed plugin using the candidate as a
  structural reference; record what is borrowed and its license.
- **build**: the survey shows a real gap; the record is the evidence that
  building is not reinventing.

Add the record to the index in `docs/plugin-evaluations/README.md`. Deliver
through the normal pull-request flow.


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

- [Web search provider selection](web-search-provider-selection.md) — 2026-09-10 — reference
  the narrow Brave provider; keep downstream credential and activation gates

- [Weather lookup](weather-lookup.md) — 2026-09-08 — build
- [Market and exchange-rate lookup](market-exchange-lookup.md) — 2026-09-08 — build
- [Steam catalog and price lookup](steam-catalog-lookup.md) — 2026-09-08 — build
- [Ordinary web lookup and extraction](web-lookup-extraction.md) — 2026-09-08 — reference
  `@deepseek-ai/dsh-web@0.1.1-rc.2` and
  `@deepseek-ai/dsh-tool-web@0.1.1-rc.2`
- [Recent community research](recent-community-research.md) — 2026-09-08 — build
- [Taiwan-focused public-discussion research](taiwan-public-discussion-research.md) — 2026-09-08 — build
- [Telegram media, vision, and location](telegram-media-vision-location.md) — 2026-09-08 — adopt
  the exact reviewed transport for its native media surface and publish a
  separate public location-input seam
- [Organization calendar mediation](organization-calendar.md) — 2026-09-08 — build
- [Conversation-scoped group notes mediation](conversation-group-notes.md) — 2026-09-08 — build
- [Read-only work recommendation mediation](work-recommendation.md) — 2026-09-08 — build
- [Governed agent-session mediation](governed-agent-session.md) — 2026-09-08 — reference
- [External agent-memory mediation](external-agent-memory.md) — 2026-09-08 — build
- [Telegram audience routing](telegram-audience-routing.md) — 2026-09-08 — build
  a public admission and routing contract beside the adopted transport
- [Telegram channel](telegram-channel.md) — updated 2026-09-26 — adopt
  `@sympoies/dsh-telegram@0.7.0`
