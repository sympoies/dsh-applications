# Layered application development and testing

This is the mandatory validation policy for material changes to
`dsh-applications`. Use the repository-local
`project-application-development` skill to apply it.

Each layer proves a different boundary. A schema test does not prove profile
composition, a repository test does not prove the exact runtime-kit and DSH
compatibility lock, and a clean checkout does not prove the coordinated release
archive. Start at the earliest layer that can prove the observable delta and
advance only while the owning issue requires more evidence.

## Validation map

Before implementation, record:

- the observable contract delta and retained public/private invariants;
- the owning package, schema, profile, catalog, fixture, or repository contract;
- the earliest proving layer and focused command;
- the expected secret-safe result and permitted side effects;
- the exact coordinated application version, runtime-kit and DSH revisions,
  package/profile identities, source tree, and archive digest needed by later
  layers;
- the receipts invalidated by the change and the outer layers actually
  required by the delta or owning issue.

Capture a meaningful failing owner test at the earliest testable layer. If a
safe failure is not practical, record the substitute validation before editing.
Use focused tests while iterating, freeze the candidate before a broad gate,
and run each declared full validation once.

Invalidated and required are different: invalidation forbids reusing stale
evidence, but does not authorize or require a provider call, release, consumer
repin, or deployment when those outcomes are outside the task.

## Validation ladder

### 1. Contract and owner tests

Prove schemas, canonical bytes, parsers, application-manager transitions,
trigger and output contracts, profile declarations, negative paths, and typed
failures with the smallest deterministic owner test. A behavior change normally
starts with a focused failing test. Documentation-only and policy-only changes
may instead use routing, link, inventory, or structural validation when no
runtime RED can meaningfully exist.

Tests must not depend on credentials, private bindings, deployment topology,
machine-local paths, or undeclared host tools. A broad repository suite is not
a substitute for the missing owner assertion.

### 2. Composition and authority-boundary tests

Exercise the exact public application, plugin/profile, or mediated-host seam
used by the change. Prove that declarations remain non-authorizing, authority
can only narrow, instance identities cannot cross, and private deployment data
does not enter public packages, profiles, locks, fixtures, or receipts.

For a new capability, first use `evaluate-dsh-plugin` to record whether an
existing plugin should be adopted, referenced, or whether a new contract is
actually required. Probe third-party candidates only in the skill's throwaway,
disabled profile.

### 3. Compatibility-lock validation

`compatibility/dsh-applications-lock.json` is the bootstrap compatibility
authority. A compatibility change must advance every exact runtime-kit, DSH,
CI checkout, contract expectation, and release-note identity that enforces the
selection.

Manifest-only validation proves the lock's internal contract without mutating
external checkouts. Exact-checkout or live DSH validation is a later layer and
runs only when the observable delta requires it and the exact source locations
are available. Never widen a version range or normalize an external checkout
to make a compatibility test pass.

### 4. Source artifact and inventory

The coordinated artifact ships reviewed, erasable TypeScript directly. There
is no generated build output and no `build`, `prepare`, or `prepack` script.
Node.js must execute the source through built-in type stripping, while
`npm run typecheck` separately proves the strict source and tool programs.

Reproduce the archive from clean trees and inspect the dry-run package
inventory. The root version coordinates every workspace component; packages
are not versioned or released independently. Record the archive digest when a
consumer needs it. Any shipped source, profile, fixture, compatibility file,
or documentation change invalidates the old archive identity.

### 5. Clean-profile and consumer acceptance

Run clean native-profile, exact-DSH, or external consumer acceptance only when
the change crosses that boundary. Bind the exact application archive,
runtime-kit and DSH revisions, profile and nested package locks, consumer
contract, and permitted side effects.

Install all profile dependencies through their declared transaction and assert
the resulting package tuple before composition. Verify independent observable
state; terminal prose and model output are supporting evidence, not sole proof.
Do not use a higher-level profile test to conceal a missing package, schema, or
compatibility assertion.

### 6. Coordinated release and hosted rollout

A release starts from independently reviewed source merged into `main`, an
annotated signed `v<semver>` tag matching the coordinated root version, and the
exact reproducible archive. The read-only job validates and packages; the
source-free publication job verifies fixed bytes and creates the immutable
checksum-bearing GitHub Release and provenance attestation.

Release, private consumer repinning, hosted acceptance, and deployment are
separate authority boundaries. A successful local package rehearsal does not
authorize a tag or release, and a successful release does not authorize a
production rollout. Follow `docs/releases.md` only when release is explicitly
in scope.

## Identity and invalidation

| Change | Invalidated evidence |
| --- | --- |
| Package behavior, schema, manager transition, or canonical bytes | Focused owner tests and every outer layer consuming that contract. |
| Profile, catalog, trigger fixture, or package lock | Profile/catalog tests, artifact identity, and affected clean-profile consumers. |
| Runtime-kit or DSH compatibility pin | Compatibility validation and every exact-checkout, native-profile, artifact, and consumer receipt using it. |
| Package source, script, dependency, shipped document, or inventory rule | Typecheck where applicable, reproducible archive, dry-run inventory, and later artifact consumers. |
| Root version or coordinated package metadata | Repository contract, archive identity, release plan, and consumer pins. |
| Agent-only routing outside the package inventory | Agent-docs and repository policy checks; artifact evidence remains current only if no shipped entrypoint changed with it. |
| Deployment-only binding or credential projection | Private deployment-owner evidence; never encode it here. |

Reviews bind to an exact head. After a repair, review the changed delta, direct
callers, earlier findings, and affected invariants. Repeat a full review only
when the new delta is cross-cutting or changes a core assumption or trust
boundary.

## Failure and replan rule

One failure is evidence, not permission for blind repetition. Repair the owner
identified by the earliest useful result. Stop and replan before another broad
run when:

- a generic failure cannot distinguish materially different stages;
- the same layer fails again without new evidence;
- a broader profile or compatibility test is being changed to conceal an
  unproved lower layer;
- exact source, compatibility, profile, artifact, target, authority, or cleanup
  state is unknown;
- progress depends on sleeps, blind retries, or human diagnosis hints;
- another full suite already owns the same mutable resources;
- the missing primitive belongs to another repository.

## Owner routing

| Observed gap | Canonical owner |
| --- | --- |
| Public application packages, schemas, profiles, catalogs, fixtures, compatibility lock, coordinated artifact, or this policy | `sympoies/dsh-applications` |
| Independently released DSH plugin behavior or package publication | `sympoies/dsh-plugins` |
| Agent loop, sessions, native tools, permissions, approvals, provider bridge, or cancellation | DSH |
| Runtime governance, admission, lifecycle, isolation, operations, or reusable receipts | `sympoies/dsh-runtime-kit` |
| Hosted trust, credentials, deployment bindings, rollout, or rollback | `serenvia/sympoies-infra` |
| Reusable agent workflow, evidence, worktree, commit, or forge primitive | `sympoies/nils-cli` or the owning agent-runtime project |

Cross-repository work needs its own authority and validation. A local
application change may identify or prepare a handoff, but this policy does not
grant the write.

## Receipt requirements

Record only what reviewers need:

- layer, owner, focused assertion, and command or bounded step;
- exact relevant source, application version, compatibility, profile, package,
  archive, and consumer identities;
- pass or fail with the earliest stable stage;
- attempted side effects, cleanup, and residual gap;
- invalidated evidence and the next permitted layer or owner.

Do not retain prompts, model responses, credentials, auth state, private
identifiers, machine-local paths, or deployment topology in this public
repository, issues, commits, release assets, or development log.

## Self-improvement loop

When work exposes repeatable friction:

1. Preserve the first bounded failure and observable result.
2. Identify the earliest layer and canonical owner that should have caught it.
3. Add a focused failing regression or record why a safe RED is impractical.
4. Repair that owner within the active authority; otherwise prepare the
   smallest handoff and stop at the boundary.
5. Resume from the first invalidated required layer.
6. Update this policy or project skill only when the lesson generalizes to
   future application work; use the development log for durable reasoning.

The loop improves tests and diagnostics. It never grants issue, release,
provider, credential, deployment, or cross-repository authority.

## Repository finish line

Use the affected focused owner command while iterating. Once the candidate is
stable, run the complete routine gate once:

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run check:compatibility -- --manifest-only
npm run verify:package-reproducibility
npm pack --dry-run --ignore-scripts
```

Add exact external checkouts, native DSH profiles, release, private consumer
acceptance, or hosted rollout only when the change invalidates that evidence
and the owning issue requires the boundary.
