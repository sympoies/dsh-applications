# Release and versioning policy

## Versions

Public packages follow Semantic Versioning 2.0.0. Before 1.0, minor releases
may add or deliberately revise public contracts and patch releases are
backward-compatible fixes. After 1.0, breaking public behavior requires a new
major version. Schema `apiVersion` evolution remains explicit and is not
inferred from package SemVer.

Workspace dependencies and external compatibility are exact. A dependency
promotion requires reviewed compatibility evidence and changes every pinned
identity that enforces the selection. A release never resolves `latest`, a
branch name, a tag range, or an unbounded SemVer range.

## Reviewed source gate

The release commit must be a reviewed commit already reachable from `main`
through a merged pull request. A maintainer creates an annotated cryptographically signed tag named
`v<semver>` whose version exactly equals the release package version. The
workflow verifies the tag signature and ancestry before executing package
steps. Pull requests and untagged commits cannot publish.

## Immutable artifacts

The workflow creates the archive twice from one clean checkout. Both SHA-256
digests must match. The published filename contains the full digest and the
release also includes `SHA256SUMS`, the exact public compatibility lock, and a
GitHub build-provenance attestation.

A tag, version, release, attestation, digest file, or archive is immutable after
publication. The workflow uses `gh release create` only and fails if the
release already exists; it never uploads into or edits an existing release.
Corrections use a new SemVer and a new signed tag.

Private deployment consumes the unopened artifact by exact digest and applies
its private trust policy. It does not build application source during deploy.
