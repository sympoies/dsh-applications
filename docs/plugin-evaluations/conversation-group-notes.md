# Conversation-scoped group notes mediation

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: build

## Survey

Queries run on 2026-09-07/08: `npm search "dsh notes"`,
`npm search "deepseek-harness notes"`, the GitHub `dsh-plugin` topic,
the `awesome-dsh-plugin` curated list, the official locked DSH tree, and the
installed official inventory. Downloads cover 2026-08-08 through 2026-09-06.

| Package | Version | License | Downloads/mo | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ------------ | ---------- |
| `dsh-notes` | 0.0.1 | MIT | 183 | 2026-08-19 | github.com/dushaobindoudou/dsh-notes |
| `dsh-notes-markdown` | 0.1.0 | MIT | 239 | 2026-08-24 | github.com/Tieboyh/dsh-notes-markdown |
| `dsh-writing-desk` | 0.1.0 | MIT | not shortlisted | 2026-08-24 | npm registry |

Curated/topic results predominantly store workspace Markdown or expose a Web
notes UI. None binds one note store to an admitted channel conversation and
audience without exposing a filesystem target.

## Evaluation

`dsh-notes@0.0.1` is only a reserved package containing a manifest and README;
it has no plugin implementation. Its exact tarball SHA-256 is
`b48a3fc24423515e39c506538fd5c8df13110b05bdd739c2d3d628a7c2b86716`.
`dsh-notes-markdown@0.1.0` is readable MIT source with no runtime dependencies
and one peer, but its storage takes and returns an absolute local notes root.
Its exact tarball SHA-256 is
`1d5ca4eade88a086b03317edd59897e3779d1119a6d3b358fea882bf68aa7026`.

## Probe results

`dsh-notes@0.0.1` passed the mechanical disabled-mount probe but declared no
DSH bundle and contains no code. `dsh-notes-markdown@0.1.0` failed installation
against locked DSH 0.1.1-rc.2 because its resolved dependency graph requires
an unavailable stable `@deepseek-ai/dsh-subagent` range.

## Decision

**Build** a strict conversation/audience/target-bound public contract with
bounded note projections and optimistic prior-receipt binding. The private
store implementation and mapping remain outside the public artifact; no local
path or storage code is borrowed.

