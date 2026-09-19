---
name: project-application-development
description: >
  Develop, diagnose, test, package, and deliver dsh-applications changes
  through the earliest independently observable validation layer, then
  strengthen the owning regression or diagnostic when acceptance exposes a
  reusable gap.
allowed-tools: Bash, Read, Edit, Write
---

# Project Application Development

Use the repository's canonical
[layered development and testing policy](../../../docs/development-testing.md)
for material application contracts, packages, profiles, compatibility,
packaging, and development-policy work. This skill applies that policy; it does
not duplicate or override it.

Use the separate `evaluate-dsh-plugin` skill before building a new DSH
capability. Its ecosystem survey and adopt/reference/build decision are an
input to this workflow, not a replacement for implementation validation.

## Contract

Before editing, produce a small validation map containing:

- the observable delta and retained public/private invariants;
- the owning package, profile, catalog, fixture, or repository contract;
- the earliest proving layer and focused command;
- the expected secret-safe receipt and permitted side effects;
- the exact application version, runtime-kit, DSH, package, profile, and
  artifact identities required by later layers;
- invalidated receipts and the outer layers actually required by the delta or
  owning issue.

Capture the earliest meaningful failing owner test when practical. Iterate at
that layer, freeze the candidate before the routine gate or external harness,
and run each declared full validation once. Stop before a mutation when target,
identity, authority, clean-room state, or prior-layer evidence cannot be
proved.

## Workflow

1. Read `docs/development-testing.md`; do not work from this summary alone.
2. Inspect the affected package, schema, profile, catalog, compatibility lock,
   callers, tests, artifact inventory, and ownership boundary. Write the
   validation map before changing production files.
3. For a new DSH capability, require a current `evaluate-dsh-plugin` record
   before implementation.
4. Add or select the focused owner regression and capture RED evidence, or
   record the substitute validation. Repair only the owning contract.
5. Advance through only the required validation layers, starting at the
   earliest one. Do not compensate for a lower-layer gap with retries or an
   assertion in a broader compatibility or native-profile test.
6. Preserve the source-artifact contract: packages are directly executable,
   erasable TypeScript with no build, `prepare`, or `prepack` step. Verify the
   reproducible coordinated archive and exact inventory instead of generating
   a second runtime representation.
7. Route missing contracts to their canonical owner rather than copying DSH,
   runtime-kit, plugin, or deployment logic into this repository.
8. Run the repository's declared routine gate once on the stable candidate.
   Perform exact-checkout, live DSH, release, consumer repin, deployment, or
   hosted acceptance only when separately authorized and required.

## Self-improvement loop

When work exposes repeatable friction, retain the first bounded failure,
identify the earliest layer that should have caught it, add a focused owner
regression, and repair the owner before resuming an outer layer. Update the
canonical policy or this skill only when the lesson applies to future
application work; keep one incident's chronology and identities in its issue
and development log.

Before delivery, ask:

- Did the failure gain an earlier deterministic owner assertion?
- Does its receipt identify a stable stage without exposing secrets?
- Does the policy tell a future agent when to stop, resume, or invalidate
  evidence?
- Is the lesson general enough for policy or skill text?

## Boundary

This skill coordinates development decisions inside
`sympoies/dsh-applications`. It does not grant deployment, provider,
credential, issue-write, release, merge, cross-repository, or hosted-run
authority. It must not copy independently released plugins from `dsh-plugins`,
runtime governance from `dsh-runtime-kit`, native agent behavior from DSH, or
deployment state from `sympoies-infra`.
