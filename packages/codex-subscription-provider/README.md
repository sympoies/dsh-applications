# Codex subscription provider descriptor

This package describes the reviewed
`@sympoies/dsh-llm-codex-subscription@0.1.4` artifact and its fixed
`codex-subscription` provider route. It does not copy, wrap, install, or execute
the native DSH plugin.

The descriptor pins the npm tarball digest, source revision, release
attestation, DSH compatibility, public route name, mediation classes, and
readiness contract. Private deployment configuration supplies the provider
endpoint and credential reference after independently admitting the exact
artifact. No host, port, path, credential, account, or rollout value is part of
this package.

Use `createCodexSubscriptionProviderDescriptor(runtimeKit)` to obtain the
runtime-kit descriptor. The caller supplies no artifact or route values, so it
cannot replace the reviewed bytes or select a different provider.

Compatibility is exact DSH `0.1.6-alpha.2`, runtime-kit contract `0.0.0`, plugin
API `1.0.0`, Linux x64, and Darwin arm64.
