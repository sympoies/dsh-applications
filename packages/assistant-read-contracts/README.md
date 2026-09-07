# Assistant read contracts

This public package defines six independently admitted, read-only assistant
capabilities: weather, market/exchange, Steam catalog prices, ordinary Web
lookup/extraction, recent community research, and Taiwan-focused public-
discussion research.

Each capability has its own stable ID, action, strict input/output schemas,
network class, timeout, byte/source budgets, and separately constructed
`PluginDescriptor`. A descriptor carries only this coordinated public package;
the private provider is selected by an opaque exact implementation digest and
binding admission outside public composition. Two bots can therefore select
the same contract while using different admitted implementations.

`authorizeAssistantReadInvocation` intersects one request with one private
admission. It rejects a wrong capability, implementation digest, audience, or
larger budget before returning the provider-neutral query. The binding digest
is deliberately never returned. `validateAssistantReadResult` accepts only a
bounded, source-attributed result or an explicit `cancelled`/`timed-out`
terminal result and rejects unknown fields that could leak a provider binding,
credential, private path, or unrelated conversation state.

The public API is `ASSISTANT_READ_CONTRACTS`,
`authorizeAssistantReadInvocation`, `validateAssistantReadResult`, and
`createAssistantReadPluginDescriptor` plus their exported types. Text bounds
count Unicode code points to match JSON Schema `maxLength`; the separate
input/output ceilings count encoded JSON bytes. The package owner is
dsh-applications. Compatibility is exact DSH `0.1.1-rc.2`, runtime-kit
contract `0.0.0`, plugin API `1.0.0`, Linux x64, and the coordinated
workspace version.

The package contains no provider client. `provider-read` is the only allowed
host action class; runtime-kit and private infrastructure own its assertion,
target binding, network broker, exact implementation admission, cancellation,
and receipts. Public descriptors request one named public-data network class
but have no filesystem, subprocess, credential-handle, general shell, or
ambient unrestricted-network authority. Every descriptor defaults to
`enabled: false`.
