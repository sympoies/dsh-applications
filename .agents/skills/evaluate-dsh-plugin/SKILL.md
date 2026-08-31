---
name: evaluate-dsh-plugin
description: >
  Before building any new DSH capability, survey the existing plugin
  ecosystem, evaluate candidates against fixed criteria, probe the best ones
  in a throwaway DSH_HOME, and record an adopt/reference/build decision under
  docs/plugin-evaluations/.
argument-hint: "[capability topic, e.g. telegram channel]"
allowed-tools: Bash, Read, Write, Edit, WebFetch, WebSearch
---

# Evaluate DSH Plugin

Do not build a new DSH capability from scratch until the existing plugin
ecosystem has been surveyed and the result is recorded. The ecosystem is
real: the official `@deepseek-ai/dsh-*` monorepo, the GitHub `dsh-plugin`
topic, the curated `awesome-dsh-plugin` list, and thousands of community
packages on the public npm registry. The output of this skill is one
evaluation record in `docs/plugin-evaluations/` with an explicit decision:
**adopt**, **reference**, or **build**.

## Contract

Prereqs:

- Run inside the `dsh-applications` git worktree.
- A concrete capability topic exists (for example "telegram channel", not
  "messaging in general").

Inputs:

- `[capability topic]` - what the new capability should do, one line.

Outputs:

- `docs/plugin-evaluations/<topic-slug>.md` following the record template in
  `docs/plugin-evaluations/README.md`, listed in that index.
- For each shortlisted candidate, a probe result produced by
  `scripts/dsh-plugin-probe.sh` (install, fail-closed composition, disabled
  activation) in a throwaway DSH_HOME.

Exit codes (probe script):

- `0`: candidate installs, composes, and mounts disabled.
- `1`: a probe step failed; record the failure in the evaluation.
- `2`: argument or environment contract violation.

Failure modes:

- Deciding **build** without a recorded survey; the survey is the proof that
  the wheel does not already exist.
- Probing a candidate in a real profile or a real DSH_HOME instead of the
  throwaway probe home.
- Approving dependency build scripts inside a probe, or enabling
  (`disabled: false`) a third-party plugin during evaluation.
- Recording registry statistics without dates; download counts and star
  counts are only meaningful with the observation date.
- Copying candidate source into this repository without checking its license
  and recording the provenance.

## Workflow

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

## Boundary

This skill writes only under `docs/plugin-evaluations/` and runs probes in
throwaway temporary directories. It must not edit packages, profiles,
compatibility pins, or any real DSH_HOME, and it never publishes, enables,
or grants authority to a third-party plugin by itself.
