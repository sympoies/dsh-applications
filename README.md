# dsh-applications

Governed public application and plugin layer for DeepSeek Harness (DSH).

This monorepo owns reusable application packages, public plugin and profile
catalogs, compatibility evidence, and immutable release artifacts. It consumes
the exact public contracts supplied by
[dsh-runtime-kit](https://github.com/sympoies/dsh-runtime-kit) and leaves DSH's
agent loop, sessions, tools, sandbox, approvals, and subagents in DSH.

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
raises the supported Node.js floor to 24.

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
npm run check:compatibility -- --manifest-only
npm run test:package
```

See [architecture](docs/architecture.md), [ownership](docs/ownership.md),
[release rules](docs/releases.md), and [contributing](CONTRIBUTING.md) before
adding a package.

## License

[MIT](LICENSE)
