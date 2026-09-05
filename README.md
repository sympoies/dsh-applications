# dsh-applications

Governed public application and plugin layer for DeepSeek Harness (DSH).

This monorepo owns reusable application packages, public plugin and profile
catalogs, compatibility evidence, and immutable release artifacts. It consumes
the exact public contracts supplied by
[dsh-runtime-kit](https://github.com/sympoies/dsh-runtime-kit) and leaves DSH's
agent loop, sessions, tools, sandbox, approvals, and subagents in DSH.

## Repository boundary

- [`sympoies/dsh-runtime-kit`](https://github.com/sympoies/dsh-runtime-kit)
  owns reusable DSH runtime governance and lifecycle contracts.
- This repository owns the coordinated public application and profile catalog.
- [`sympoies/dsh-plugins`](https://github.com/sympoies/dsh-plugins) owns
  independently released DSH plugins.

Private deployment bindings, host and service identity, installation or
channel identifiers, credentials, ingress, rollout state, and personal
operator configuration are intentionally outside this repository.

Workspace packages are components of one coordinated application artifact and
share the root version. The private root prevents registry publication; the
reviewed, digest-addressed GitHub release is the distribution boundary.

## Current status

The workspace contains the public plugin declaration helpers, the isolated DSH
`0.1.1-rc.2` adapter, the generic ten-operation application manager, portable
GitHub read/review-result contracts, four least-authority bot profiles, and
reusable manual, GitHub-event, channel, and schedule trigger fixtures. Version
`0.1.3` is the first published coordinated catalog release; `0.2.0` adds the
GitHub contracts and complete native review-output schema. Version `0.3.0`
raises the supported Node.js floor to 24 and requires fingerprinted native
threads for every actionable GitHub review finding.

## Development

Install Node.js through [fnm](https://github.com/Schniz/fnm), then activate the
repository-pinned Node.js 24 runtime and exact npm version:

```sh
fnm use
npm install --global npm@11.6.2 --ignore-scripts
npm ci --ignore-scripts
npm run test:manager-contract
npm run test:manager-faults
npm run test:plugin-sandbox
npm run test:profiles
npm run test:github-contracts
npm test
npm run typecheck
npm run check:compatibility -- --manifest-only
npm run test:package
```

The workspace packages are written in erasable TypeScript that Node.js 24
executes directly through its built-in type stripping. There is no build step:
`exports` point at the `.ts` sources, the shipped tarball is the reviewed
source, and `npm run typecheck` (`tsc --noEmit`) is the only compiler
invocation. Node.js 24 or newer is therefore a runtime requirement, not only a
development one.

Two consequences follow for anyone consuming the packages outside this
workspace:

- Node.js does not strip types for files under a `node_modules` directory, so
  the packages load only from an unpacked artifact root (which is how the
  release artifact is consumed), never from an `npm install` into a consumer's
  `node_modules`.
- A TypeScript consumer compiles these sources with its own compiler options,
  since no separate declaration file is shipped. The sources compile under
  `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` and
  need `@types/node` in scope. `@sympoies/dsh-rc2-adapter` binds its public
  types to the optional DSH peer packages; a consumer without those peers adds
  `packages/dsh-rc2-adapter/types/dsh-peer-fallbacks.d.ts` to its program
  instead. `test/fixtures/typescript-consumer/consumer.ts` is the checked
  example of such a consumer.

See [architecture](docs/architecture.md), [ownership](docs/ownership.md),
[release rules](docs/releases.md), [development log](docs/devlog/README.md),
and [contributing](CONTRIBUTING.md) before adding a package.

## License

[MIT](LICENSE)
