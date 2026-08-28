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

## Current status

The repository currently contains only its governed workspace bootstrap. The
plugin SDK, application manager, adapters, and profile catalog will arrive in
separately reviewed changes. Empty package namespaces are not runtime APIs.

## Development

Use Node.js 22.19.0 and npm 11.6.2, then run:

```sh
npm ci --ignore-scripts
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
