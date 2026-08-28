# Architecture

## Position

`dsh-applications` is the reusable public application layer above
`dsh-runtime-kit`. It will contain public plugin helpers, trigger and output
contracts, a public per-instance application manager, generic adapters, and
declarative bot profiles. This bootstrap defines only the repository and
artifact boundary; it does not implement those components.

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
packages/       future independently versioned public packages
compatibility/  exact accepted dependency identities
docs/           architecture, ownership, and release contracts
scripts/        repository and release verification only
test/           repository-level contract tests
.github/        read-only CI and reviewed-tag release automation
```

The root workspace is private and is never an npm registry product. Releasable
packages will declare their own names, versions, files, exports, and tests.
Until those packages exist, the root archive is a reproducibility and supply-
chain bootstrap artifact only.

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
tag on a reviewed `main` commit starts the release workflow. The workflow
repeats compatibility and repository validation, creates the package archive
twice, requires byte-identical SHA-256 digests, names the artifact with that
digest, produces `SHA256SUMS`, creates a GitHub build-provenance attestation,
and creates the release once.

Private deployment systems may fetch the unopened blob by exact digest and
apply their own trust policy. They must never build this source during deploy,
and their bindings, identities, secrets, services, ingress, rollout, traffic,
and rollback state do not flow back into this repository.
