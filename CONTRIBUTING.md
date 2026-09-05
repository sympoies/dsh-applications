# Contributing

## Prerequisites

- fnm with the repository-pinned Node.js 24 runtime (`fnm use`); Node.js 24
  executes the TypeScript sources directly through built-in type stripping, so
  it is a runtime requirement as well as a development one
- npm 11.6.2
- a clean checkout with no private configuration copied into it

Install without lifecycle scripts:

```sh
fnm use
npm install --global npm@11.6.2 --ignore-scripts
npm ci --ignore-scripts
```

## Change contract

Keep changes inside the public ownership boundary described in
`docs/ownership.md`. New packages live below `packages/<name>/` and must have a
single public responsibility, strict inputs, tests, documentation, and exact
workspace dependencies. Package sources are erasable TypeScript
(`src/index.ts`): only syntax that Node.js can strip is allowed (no `enum`,
`namespace`, parameter properties, or decorators), `exports` point at the
`.ts` source, exported types live in the source rather than in a hand-written
declaration file, and `npm run typecheck` must pass alongside `npm test`.
Do not add a build, `prepare`, or `prepack` script. `tsconfig.json` keeps
`allowImportingTsExtensions` on even though every package is a single file
today: the moment a package grows a second module, Node requires the relative
import to name the `.ts` file explicitly, and the option makes `tsc` accept
the same spelling. All components share the root coordinated version and
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
