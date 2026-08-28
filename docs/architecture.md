# Architecture

## Position

`dsh-applications` is the reusable public application layer above
`dsh-runtime-kit`. It contains public plugin helpers, trigger and output
contracts, a public per-instance application manager, and one isolated adapter
for the exact DSH rc2 public services. Declarative bot profiles are the next
coordinated catalog layer.

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
compatibility/  exact accepted dependency identities
docs/           architecture, ownership, and release contracts
scripts/        repository and release verification only
test/           repository-level contract tests
.github/        read-only CI and reviewed-tag release automation
```

The workspace produces a single coordinated public application artifact. Its
packages are components, not independently released products: they share the
root version and are reviewed, tested, tagged, and published together. The
root workspace remains private at bootstrap version `0.0.0` until Task 3.3
promotes the first coordinated version. That bootstrap version cannot publish.

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
