# Public package namespaces

Reusable application components live in one directory per package under this
folder. They share the root workspace version and are reviewed, tagged, and
released together as one coordinated public application artifact.

- `plugin-sdk` delegates canonical plugin descriptors to runtime-kit and owns
  typed trigger/output configuration helpers.
- `dsh-rc2-adapter` isolates all direct DSH `0.1.1-rc.2` calls and requires
  instance-bound DSH confinement.
- `manager` provides the exact ten-operation facade, authenticated internal
  control construction, and runtime-kit-mediated plugin action gateway.

The coordinated artifact also carries the public `profiles/` catalog and the
reusable, non-authorizing `fixtures/` trigger configurations. These are not
independently versioned packages.

The artifact intentionally contains no provider credential boundary, private
deployment binding, artifact installer, or traffic service.

A package directory is admitted only with its own exact metadata, public API
boundary, tests, compatibility declaration, and independently reviewed change.
Admission does not create an independently versioned or published product.
