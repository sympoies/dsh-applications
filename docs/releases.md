# Release and versioning policy

## Versions

The public application artifact follows Semantic Versioning 2.0.0. Every
workspace component ships together under one coordinated version from the
root `package.json`; components are never tagged or published independently.
Before 1.0, minor releases may add or deliberately revise public contracts and
patch releases are backward-compatible fixes. After 1.0, breaking public
behavior requires a new major version. Schema `apiVersion` evolution remains
explicit and is not inferred from package SemVer.

The immutable `v0.1.0` through `v0.1.2` tags record failed pre-publication
workflow attempts and have no GitHub Release or consumable artifact. Version
`0.1.3` is the first published coordinated application and profile-catalog
release. The private root prevents registry publication; the release workflow
also rejects `0.0.0`, so a bootstrap revision cannot be published accidentally.

Version `0.9.1` adopts the official `@sympoies/dsh-telegram@0.6.1` artifact,
records its immutable npm and source identities in the public compatibility
lock, and keeps the native profile install compatible with its reviewed peer
dependency graph.

Version `0.9.2` advances the Telegram transport to
`@sympoies/dsh-telegram@0.6.2`, which repairs session-picker polling without
changing the public application capability or authority boundary.

Version `0.9.3` advances the coordinated compatibility line to DSH
`0.1.6-alpha.2`, its reviewed runtime-kit owner, and
`@sympoies/dsh-telegram@0.6.3`. The Telegram release keeps the existing
capability and authority boundary while declaring the exact alpha.2 peer graph.

Version `0.9.4` advances the exact reviewed
`@sympoies/dsh-llm-codex-subscription` artifact to `0.1.4`.

Version `0.10.0` adds the Calendar invitation-response mutation and the
attendee response status on calendar receipt events. The write request's new
`respond` mutation carries only an opaque event reference and one of
`accepted`, `declined`, or `tentative`; both calendar receipts may report the
bound account's own `responseStatus`.

Version `0.10.1` pins the reviewed `@sympoies/dsh-telegram@0.7.0` artifact,
which accepts voice messages through a deployment-bound speech service and
continues the DSH conversation with the transcript. Its public profile ceiling
adds the bounded `speech-service` network class; the descriptor declares the
matching `speech-service-token` credential-handle class. Endpoint, credential
reference, and enablement remain private deployment bindings.

Workspace dependencies and external compatibility are exact. A dependency
promotion requires reviewed compatibility evidence and changes every pinned
identity that enforces the selection. A release never resolves `latest`, a
branch name, a tag range, or an unbounded SemVer range.

## Migrating GitHub review producers to v0.3

The v0.3 GitHub review profile requires `github-review-publish` version 0.3.0
or newer within the pre-1.0 line. A v0.2 publisher is incompatible because it
does not require structured findings or stable native-thread fingerprints and
must not be selected for this profile. Producers must emit the v0.3 output
schema digest, use the corresponding worker-result schema identity, and
upgrade the publisher before the profile or broker binding advances.

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
  --version 0.10.1 \
  --expected-head <full-main-commit> \
  --repository sympoies/dsh-applications
.agents/scripts/release.sh --execute \
  --version 0.10.1 \
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
