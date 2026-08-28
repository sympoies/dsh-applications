# Ownership

The one-way dependency and authority boundary is normative. Each concern has
one owner; dsh-applications does not provide a fallback implementation for a
missing owner.

| Owner | Owns | Explicitly outside dsh-applications |
| --- | --- | --- |
| DeepSeek Harness | Agent loop, sessions, native tools, cancellation, approvals, sandbox, skills, subagents, and live run state | Reimplementing or wrapping these as a second loop |
| nils-cli | Shared deterministic repository, worktree, and policy decisions | Application discovery, profiles, deployment, or provider integration |
| dsh-runtime-kit | Public composition, authority intersection, admission, trust, per-instance workload lifecycle, isolation, and receipts | Artifact install, deployment bindings, traffic, and provider credentials |
| dsh-applications | Reusable public packages, plugin/profile catalog, public compatibility evidence, and application orchestration for one admitted instance | Private deployment validation, artifact installation, rollout, and cross-generation recovery |
| sympoies-infra | Private artifact trust and staging, bindings, service/runtime identity, deployment generations, traffic, rollout, rollback, broker, and live operations | Reusable public application source |
| local-scripts | Personal shell environment, interactive setup/rotation UX, secret-safe handoff, and personal identity selection | Production services, deployment state, or canonical public profiles |
| Secret owners | Credential values, signing keys, tokens, and runtime-only authentication state | Any public manifest, lock, log, receipt, issue, or release asset |

Provider and channel adapters authenticate data at their named boundary. They
do not own lifecycle or deployment authority. In particular, a future GitHub
adapter must use the private broker for credentialed writes; public package
code never contains an App identity or credential.
