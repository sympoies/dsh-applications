# Governed action contracts

This package owns five independently selectable, provider-neutral public
descriptor and payload families:

- scoped calendar read and write;
- conversation-scoped group-note read and write;
- read-only work recommendations from one admitted source;
- bounded recall and candidate-only proposal writes to an external agent-memory
  store; and
- governed DSH agent-session create, status, metadata attachment, continue,
  and cancel.

Every request repeats an opaque deployment, audience, conversation, and target
scope. A private adapter mints those keyed references and passes the expected
binding separately; these validators reject any model-supplied substitution.
The real calendar, note store, organization source, agent-memory store,
workspace, session, credential, and provider identity never enter this
package. Candidate-add cannot directly commit or rewrite retained memory; the
private store owner reviews and resolves proposals.

Mutation and session operations are distinct descriptor action IDs with
required idempotency. DSH and dsh-runtime-kit own user approval, target-scope
authority, runtime assertions, execution, lifecycle, cancellation, replay
journals, and the cryptographic host-action receipt. This package adds only a
bounded Telegram-suitable output projection correlated to the admitted request
and prior receipt. It does not implement an approval mechanism, agent loop,
session store, provider client, broad filesystem access, or shell execution.

Downstream profiles must explicitly select each descriptor and grant each
capability. The repository's conversation-only profiles intentionally select
none of them.
