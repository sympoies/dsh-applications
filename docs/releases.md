# Release and versioning policy

## Versions

The public application artifact follows Semantic Versioning 2.0.0. Every
workspace component ships together under one coordinated version from the
root `package.json`; components are never tagged or published independently.
Before 1.0, minor releases may add or deliberately revise public contracts and
patch releases are backward-compatible fixes. After 1.0, breaking public
behavior requires a new major version. Schema `apiVersion` evolution remains
explicit and is not inferred from package SemVer.

Version `0.1.0` is the first coordinated application and profile-catalog
release. The private root prevents registry publication; the release workflow
also rejects `0.0.0`, so a bootstrap revision cannot be published accidentally.

Workspace dependencies and external compatibility are exact. A dependency
promotion requires reviewed compatibility evidence and changes every pinned
identity that enforces the selection. A release never resolves `latest`, a
branch name, a tag range, or an unbounded SemVer range.

## Reviewed source gate

The release commit must be reviewed before merge into `main` and equal the merge
revision of exactly one same-repository pull request. At least one identity other than the
pull-request author must have an `APPROVED` latest decisive review for that
pull request's exact head revision. Direct-main, unapproved, dismissed,
stale-review, fork-associated, and ambiguous commits fail closed.
A maintainer creates an annotated cryptographically signed tag named
`v<semver>` whose version exactly equals the coordinated root version. The
workflow verifies the tag signature and ancestry before executing package
steps. Pull requests and untagged commits cannot publish.

The repository-owned release entrypoint performs the same source and provider
gates before it creates the tag. Run its read-only mode first, then repeat the
exact pinned invocation with `--execute`:

```sh
.agents/scripts/release.sh --dry-run \
  --version 0.1.0 \
  --expected-head <full-main-commit> \
  --repository sympoies/dsh-applications
.agents/scripts/release.sh --execute \
  --version 0.1.0 \
  --expected-head <same-full-main-commit> \
  --repository sympoies/dsh-applications
```

`--verify-only` resumes immutable provider read-back after the tag has already
been published; it never recreates or replaces the tag or release.

## Immutable artifacts

The read-only verification job validates the repository and exact compatibility
checkouts before packaging from a fresh clean checkout of the exact tagged
commit. Packaging fails if the checkout revision changes or any package input
is dirty before or after `npm pack`. The published filename contains the full
digest and the release also includes a flat, `sha256sum -c` compatible
`SHA256SUMS`, the exact public compatibility lock, and a GitHub build-provenance
attestation.

Only the second job receives `contents: write`, `id-token: write`, and
`attestations: write`. It downloads the fixed outputs from the read-only job,
checks their digest, and publishes without checking out source or running npm or
project code.

A tag, version, release, attestation, digest file, or archive is immutable after
publication. The workflow uses `gh release create` only and fails if the
release already exists; it never uploads into or edits an existing release.
Corrections use a new SemVer and a new signed tag.

Private deployment consumes the unopened artifact by exact digest and applies
its private trust policy. It does not build application source during deploy.
