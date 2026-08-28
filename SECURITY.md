# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting or a private repository security
advisory. Do not open a public issue for a suspected vulnerability, credential,
private deployment detail, or exploit proof. Include the affected release,
artifact digest, impact, and a minimal secret-free reproduction when possible.

Never commit or attach tokens, keys, credential values, private topology,
installation identifiers, private bindings, runtime state, or personal paths.
If material is exposed, rotate it through its private owner before discussing
the source change publicly.

## Supported versions

Until the first stable release, only the newest published prerelease is
supported. After 1.0, the newest minor line receives security fixes. A security
fix always produces a new immutable release; existing tags and assets are not
rewritten.

## Trust boundary

Public package metadata and descriptors are untrusted inputs. They may request
capabilities but do not grant them. dsh-runtime-kit and DSH retain admission,
runtime, isolation, and agent-loop authority; private infrastructure retains
artifact trust, deployment, provider credentials, traffic, and rollback.
