# Public package namespaces

Future reusable application components live in one directory per package under
this folder. They share the root workspace version and are reviewed, tagged,
and released together as one coordinated public application artifact. The
bootstrap intentionally contains no plugin SDK, application manager, bot
profile, provider adapter, deployment binding, or service.

A package directory is admitted only with its own exact metadata, public API
boundary, tests, compatibility declaration, and independently reviewed change.
Admission does not create an independently versioned or published product.
