# Plugin SDK

This package owns immutable authoring helpers for public trigger and output
configuration. `definePlugin` does not define a second descriptor schema: it
requires and delegates to the exact runtime-kit `validatePluginDescriptor`
owner, then preserves that canonical `runtime.sympoies.dev/v1` document.
`defineDigest` is the typed construction boundary for canonical 64-hex SHA-256
identities; descriptor helpers reject unknown top-level and nested fields at
compile time, and repeat the same checks at runtime for untyped consumers.
A declaration requests capability; it never grants authority. Runtime
validation, secret checks, digests, authority intersection, assertions,
lifecycle state, and mediated effects remain owned by `dsh-runtime-kit`.

Plugins do not receive ambient filesystem, network, subprocess, environment,
host-socket, credential, secret, provider, clock, random, or cross-instance
access. Execution is accepted only through the DSH rc2 adapter's enforced agent
scope, and every host effect uses a complete runtime-kit
`MediatedHostActionRequest`.
