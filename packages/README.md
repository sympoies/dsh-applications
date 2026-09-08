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
- `github-read` validates a bounded, model-safe projection of a broker-admitted
  pull request without provider access or authority.
- `github-review-publish` constructs the strict, canonical, non-bearer public
  review worker result; private broker code owns provider publication.
- `conversation-agent` validates one conversation turn and reply for the
  `conversational` profile, admitting channel context only as opaque
  deployment-scoped refs; channel ingress and delivery stay adapter-owned.
- `telegram-channel` describes the exact reviewed external Telegram artifact,
  its disabled public default, and the bounded mediation it may request after
  private admission; it contains no Telegram client or binding.
- `assistant-read-contracts` defines six independently admitted provider-read
  contracts for weather, market/exchange, Steam catalog, ordinary Web, recent
  community, and Taiwan public-discussion results. It validates opaque exact
  implementation/audience admission without containing a provider client or
  private binding.
- `governed-action-contracts` defines independently selectable, opaque-scope
  calendar, group-note, work-recommendation, external-memory, and DSH-owned
  agent-session action contracts. Runtime-kit still owns approval, execution,
  replay, and receipts.

The coordinated artifact also carries the public `profiles/` catalog and the
reusable, non-authorizing `fixtures/` trigger configurations. These are not
independently versioned packages.

The artifact intentionally contains no provider credential boundary, private
deployment binding, artifact installer, or traffic service.

Every package is erasable TypeScript at `src/index.ts`, executed by Node.js 24
without a build step and exporting its public types from the same source file.

A package directory is admitted only with its own exact metadata, public API
boundary, tests, compatibility declaration, and independently reviewed change.
Admission does not create an independently versioned or published product.
