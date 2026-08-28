# Contributing

## Prerequisites

- Node.js 22.19.0
- npm 11.6.2
- a clean checkout with no private configuration copied into it

Install without lifecycle scripts:

```sh
npm ci --ignore-scripts
```

## Change contract

Keep changes inside the public ownership boundary described in
`docs/ownership.md`. New packages live below `packages/<name>/` and must have a
single public responsibility, strict inputs, tests, documentation, and exact
workspace dependencies. All components share the root coordinated version and
release artifact; do not version or publish a workspace independently. Do not
put deployment manifests, service definitions,
credential references, environment-specific routes, or operator scripts here.

For behavior changes, add the focused owner test first and record the expected
failure before implementing the behavior. Run:

```sh
npm run test:repository-contract
npm test
npm run check:compatibility -- --manifest-only
npm run verify:package-reproducibility
npm pack --dry-run
```

Compatibility changes must update the machine-readable lock, both exact CI
checkout refs, contract expectations, and documentation in one reviewed pull
request. Version-range widening without evidence is not accepted.

## Review and release

All changes use pull requests. A release tag points at a commit from exactly one
merged same-repository pull request on `main`, with a latest-state exact-head
approval by a reviewer other than its author. The release workflow verifies the signed tag,
exact dependency checkouts, tests, clean source, digest, and provenance before
it creates an immutable GitHub release.
