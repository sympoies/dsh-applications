# Repository policy

This repository owns the public, reusable application and plugin layer for
DeepSeek Harness (DSH).

## Scope

- Keep packages portable, public, secret-free, and reproducible from a clean
  checkout.
- Consume the exact reviewed dsh-runtime-kit and DSH identities in
  `compatibility/dsh-applications-lock.json`.
- Use dsh-runtime-kit for composition, authority intersection, admission,
  workload lifecycle, trust, isolation, and receipts. Use nils-cli for shared
  deterministic repository and worktree policy.
- Leave the DSH agent loop, sessions, tools, sandbox, approvals, skills, and
  subagents in DSH.

## Public/private boundary

- Public descriptors and profiles may declare requested capabilities, but
  declarations never enforce or grant authority.
- This repository MUST NOT contain private deployment bindings or topology,
  service or OS identities, installation/repository/channel identifiers,
  credentials, secret locators or values, ingress, rollout/canary state,
  personal operator settings, or private source paths.
- Private infrastructure may consume a reviewed release by exact artifact
  digest. Public code must not discover ambient private directories or accept
  private state into a public composition lock.
- Do not duplicate the runtime-kit or nils-cli policy engine and do not create
  a second agent loop, deployment controller, artifact installer, traffic
  controller, or provider credential boundary.

## Changes and validation

- Add or change testable behavior with a meaningful failing owner test first,
  then make the same command pass.
- Run `npm ci --ignore-scripts`, the affected focused tests, `npm test`,
  `npm run check:compatibility -- --manifest-only`,
  `npm run verify:package-reproducibility`, and `npm pack --dry-run` before
  delivery.
- Keep workspace dependencies exact. Compatibility-pin changes are deliberate
  review events and must update the lock, CI checkout identities, tests, and
  release notes together.
- Package code belongs under `packages/<name>/`. A package must declare its
  public owner, API boundary, compatibility, and tests before it becomes a
  release artifact.

## Releases

- Release only from an independently reviewed commit reachable from `main`
  through an annotated, cryptographically signed `v<semver>` tag.
- Tags, GitHub releases, attestations, and release assets are immutable. Never
  replace an asset or reuse a version; publish a new SemVer instead.
- GitHub Actions and source dependencies use full immutable commit identities,
  never floating branches or major-version tags.
