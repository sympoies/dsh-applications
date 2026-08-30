# GitHub read contracts

This public package validates the bounded, model-safe projection of a broker-
admitted pull request. Repository content and threads remain untrusted data.
Target, exact head, changed paths, generation, instance, admission, output
schema, and publisher epoch are opaque server-owned bindings that this package
only validates and echoes; it never derives or grants provider authority.

`@mes_bot review` is a compatibility trigger only. It cannot select the
publisher, mint a token, widen the admitted path set, or authorize a general
issue-comment action. The private broker derives publisher routing from the
server-owned repository owner and rejects unknown or cross-owner selections
before token minting; public package code never selects an App identity.

The package has no network client, credentials, secret locator, private
topology, deployment binding, or provider-write API.

`createGitHubReadPluginDescriptor` turns an admitted immutable coordinated-
release digest, source revision, and attestation identity into the exact
`runtime.sympoies.dev/v1` descriptor for `github-read`. Runtime-kit computes
and validates the descriptor digest. The package fixes its action schemas,
compatibility, empty ambient network/credential requirements, and health
probe; a caller cannot use the artifact-identity input to widen them.
