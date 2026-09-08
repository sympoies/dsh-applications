# Assistant read contracts

This public package defines six independently admitted, read-only assistant
capabilities: weather, market/exchange, Steam catalog prices, ordinary Web
lookup/extraction, recent community research, and Taiwan-focused public-
discussion research.

Weather callers may optionally authorize `hourlyHours` from 1 through 24. A
completed result can then include at most that many hourly entries, each with a
canonical UTC timestamp, bounded temperature and condition, and precipitation
probability from 0 through 1. Timestamps must be strictly increasing and fall
within the half-open interval from the result's `asOf` instant through the
authorized number of hours. Requests that omit `hourlyHours` retain the
current/daily result shape and do not authorize an hourly projection.

Each capability has its own stable ID, action, strict input/output schemas,
network class, timeout, byte/source budgets, and separately constructed
`PluginDescriptor`. A descriptor carries only this coordinated public package;
the private provider is selected by an opaque exact implementation digest and
binding admission outside public composition. Two bots can therefore select
the same contract while using different admitted implementations.

`authorizeAssistantReadInvocation` intersects one request with one private
admission. It rejects a wrong capability, implementation digest, audience, or
larger budget before returning an immutable provider-neutral context. That
context retains the non-secret admission, implementation, binding-assertion,
and audience identities required for broker receipts and confused-deputy
checks. A private broker MUST match those identities to its authenticated
runtime assertion before execution. `validateAssistantReadResult` consumes
that exact context, applies the request's output/source limits and
input-derived cardinality, and accepts only a source-attributed result or an
explicit `cancelled`/`timed-out` terminal result. Result envelopes reject
provider bindings, credentials, private paths, and unrelated conversation
state.

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

For Web extraction, public validation accepts only credential-free HTTP(S)
DNS names and rejects literal addresses and localhost names. The provider-read
broker MUST resolve every DNS answer as public before connecting and repeat
the complete target check for every redirect, stopping after five redirects.
Validation before DNS is not proof that a hostname remains public.

The digest-bound JSON Schemas own all JSON-Schema-expressible constraints.
The exported validators additionally own request-to-result binding,
chronological freshness, and exact research windows that a standalone schema
cannot express. The public broker policy separately owns DNS-answer and
redirect-target revalidation. Transport owners MUST enforce the declared raw
byte ceiling before JSON decoding; these functions validate an already-decoded
value and cannot retroactively bound parser allocation.
