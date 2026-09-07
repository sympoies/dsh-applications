# Architecture

## Position

`dsh-applications` is the reusable public application layer above
`dsh-runtime-kit`. It contains public plugin helpers, trigger and output
contracts, a public per-instance application manager, one isolated adapter for
the exact DSH rc2 public services, and the coordinated public bot-profile and
trigger-fixture catalog.

The dependency direction is one way:

```text
private deployment controller
  -> public dsh-applications packages
    -> dsh-runtime-kit
      -> DSH
      -> nils-cli policy decisions
```

Later layers may narrow declared authority. Installation, discovery, a plugin
descriptor, or a bot profile never grants authority and cannot widen an
earlier layer.

## Workspace layout

```text
packages/       components of one coordinated public application
profiles/       least-authority public BotProfile documents and schemas
fixtures/       reusable non-authorizing public trigger configuration
compatibility/  exact accepted dependency identities
docs/           architecture, ownership, and release contracts
scripts/        repository and release verification only
test/           repository-level contract tests
.github/        read-only CI and reviewed-tag release automation
```

The workspace produces a single coordinated public application artifact. Its
packages are components, not independently released products: they share the
root version and are reviewed, tested, tagged, and published together. Version
`0.1.3` is the first published coordinated catalog release. Coordinated version
`0.2.0` adds the public GitHub read and strict review-result contracts;
`0.2.1` raises the supported Node.js floor to 24. The root remains private to
prevent registry publication; release consumers use the digest-addressed
coordinated archive.

## Manager and execution boundary

The manager facade exposes exactly `validate`, `resolve`, `lock`, `start`,
`resume`, `status`, `interrupt`, `drain`, `stop`, and `doctor`. Runtime-kit owns
composition validation, lifecycle state, CAS replay, receipts, trust,
assertions, reconciliation, and mediated host effects. Internal
`instance.reconcile` is available only through runtime-kit's authenticated
control service; the public facade cannot assign state.

All direct DSH calls are isolated in the rc2 adapter. Each admitted instance
uses distinct roots, sessions, memory, queues, credential handles, budgets, and
concurrency controllers. DSH owns the agent loop, persistence, cancellation,
tool registry, monotonic guard, restrictions, and enforced sandbox. The
application layer never claims that a same-process JavaScript wrapper is a
sandbox. Plugin invocation requires current identity-bound confinement evidence
from the instance's DSH runtime and cannot cross a runtime-kit lifecycle receipt
epoch. Invocation-scoped host capabilities are revoked before DSH in-flight
accounting ends, and every host effect is a bounded, detached, complete
runtime-kit `MediatedHostActionRequest`.

The plugin SDK does not define a parallel PluginDescriptor schema. It delegates
the canonical `runtime.sympoies.dev/v1` descriptor, digest, and secret checks to
the exact runtime-kit validator. The SDK exposes a typed canonical-digest
constructor and exact descriptor inputs while retaining runtime validation for
untyped callers. Trigger and output helpers are immutable
application configuration only; neither can grant or widen authority.

The GitHub packages expose no provider client or bearer material. The read
contract treats pull-request content as untrusted and echoes only broker-issued
target/head/path/generation/admission/epoch bindings. The review contract emits
one strict `GitHubReviewWorkerResult` whose complete Review Report and bounded
native inline guidance are RFC 8785 canonicalized and domain-digest bound. The
authenticated supervisor completion envelope and every provider effect remain
private-infrastructure responsibilities.

The Telegram channel package similarly contains no channel client. It binds a
reviewed external npm artifact to its exact version, tarball digest, source
revision, provenance identity, required conversation capabilities, and bounded
mediation classes. The companion public profile mounts that artifact disabled
and carries a nested npm lockfile consumed with `npm ci --ignore-scripts`, so a
clean native-profile install uses the dependency graph that was reviewed.
Private infrastructure alone owns the credential and access bindings and the
admission decision that may enable it.

The assistant read-contract package contains no data-provider clients. It
defines six separate action descriptors rather than one aggregate grant, so a
deployment can admit weather without also admitting market, Steam, Web, or
research. Each action fixes a strict query/result schema, one named public-data
network class, provider-read-only host mediation, cancellation, and byte,
source, and timeout ceilings. A private admission binds an opaque exact
implementation digest and audience; the immutable authorized context retains
non-secret admission, binding-assertion, and audience identities for broker
matching and receipts, while strict result envelopes cannot carry them or
conversation state. DSH still owns cancellation and runtime execution, while
runtime-kit and the private broker own assertions, target binding, budget
debit, DNS/redirect revalidation, and receipts.

The governed-action package contributes only payload validation and separately
selectable descriptors for organization calendar data, conversation-scoped
group notes, read-only work recommendations, external agent-memory recall and
candidate proposals, and DSH-owned agent sessions. Each request must match an
independently supplied opaque deployment/audience/conversation/target binding;
the admitted action, workspace, live-session reference, and current session
state receive the same treatment where applicable. Each action owns distinct
input and output schema digests, and each receipt family rejects action IDs
outside its advertised set. Mutation actions require idempotency and remain
subject to downstream per-action approval. A private adapter forwards the
validated `requestRef` unchanged as the runtime-kit mediated host action's
`idempotencyKey`; runtime-kit remains the sole replay journal and request-digest
conflict owner. DSH and runtime-kit continue to own the agent loop, session
store, approval, cancellation, target resolution, execution, and cryptographic
receipt, while private adapters own real data and credentials.

## Compatibility

`compatibility/dsh-applications-lock.json` is the sole bootstrap compatibility
input. It pins the accepted dsh-runtime-kit merge containing composition and
workload-manager contracts and the exact DSH release-candidate tag, revision,
and version authenticated by that runtime-kit revision.

CI checks out both repositories at those full revisions. The compatibility
validator proves checkout identity, expected runtime-kit exports, the runtime-
kit DSH compatibility row, and DSH package version. Unknown, floating, dirty,
or mismatched inputs fail closed.

## Artifact flow

Pull-request CI is read-only and produces no release. A signed annotated SemVer
tag on an independently approved pull-request commit merged into `main` starts
the release workflow. A read-only job repeats compatibility and repository
validation, then packages a fresh clean checkout of the exact tagged revision.
It names the artifact with its SHA-256 digest and produces a flat
`SHA256SUMS`. A separate minimal privileged job executes no project code; it
verifies the fixed build outputs, creates a GitHub build-provenance attestation,
and creates the release once.

Private deployment systems may fetch the unopened blob by exact digest and
apply their own trust policy. They must never build this source during deploy,
and their bindings, identities, secrets, services, ingress, rollout, traffic,
and rollback state do not flow back into this repository.
