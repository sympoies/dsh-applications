# Public trigger fixtures

These fixtures describe reusable ingress classes. They carry only an input
schema and the workload-facing trigger class; they never select a profile,
grant a capability, bind a deployment, or contain provider credentials.

The descriptor is accepted by `@sympoies/dsh-plugin-sdk`. `profileClass` is the
corresponding public `BotProfile.triggers[].class` value owned by runtime-kit.
An adapter may bind a fixture only to a profile that already allows that class.

Every `inputSchemaDigest` is SHA-256 over the exact UTF-8 bytes of the named
schema file, rendered as `sha256:<hex>`.
