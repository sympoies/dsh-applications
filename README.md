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
share the root version. The private `0.0.0` root is a bootstrap control surface,
not a publishable release, until Task 3.3 promotes the coordinated version.

## Current status

The workspace contains the public plugin declaration helpers, the isolated DSH
`0.1.1-rc.2` adapter, and the generic ten-operation application manager. The
initial profile catalog and first coordinated release remain separate reviewed
work. All current packages retain bootstrap version `0.0.0` and cannot publish.

## Development

Use Node.js 22.19.0 and npm 11.6.2, then run:

```sh
npm ci --ignore-scripts
npm run test:manager-contract
npm run test:manager-faults
npm run test:plugin-sandbox
npm test
npm run check:compatibility -- --manifest-only
npm run verify:package-reproducibility
npm pack --dry-run
```

See [architecture](docs/architecture.md), [ownership](docs/ownership.md),
[release rules](docs/releases.md), and [contributing](CONTRIBUTING.md) before
adding a package.

## License

[MIT](LICENSE)
