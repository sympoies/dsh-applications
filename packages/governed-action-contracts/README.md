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
binding and admitted action separately; these validators reject any
model-supplied substitution or sibling action. Every action has its own input
and output schema digest, and a receipt validator accepts only the action IDs
owned by its capability family.
The real calendar, note store, organization source, agent-memory store,
workspace, session, credential, and provider identity never enter this
package. Candidate-add cannot directly commit or rewrite retained memory; the
private store owner reviews and resolves proposals.

Mutation and session operations are distinct descriptor action IDs with
required idempotency. For those actions, the private adapter MUST pass the
validated `requestRef` unchanged as the runtime-kit's
`MediatedHostActionRequest.idempotencyKey`; the runtime request digest binds the
action and payload, and the runtime-kit journal owns duplicate, conflict, and
indeterminate-effect handling. This package does not add a second replay
journal or client retry mechanism.

DSH and dsh-runtime-kit own user approval, target-scope authority, runtime
assertions, execution, lifecycle, cancellation, replay journals, and the
cryptographic host-action receipt. This package adds only bounded
Telegram-suitable output projections correlated to the admitted request and,
where applicable, the trusted workspace, live session, current state, and
prior receipt. Calendar output uses a 256 KiB sandbox budget so the documented
16-event maximum remains valid for maximum-size UTF-8 fields; the other
families retain the default 64 KiB budget. It does not implement an approval
mechanism, agent loop, session store, provider client, broad filesystem access,
or shell execution.

Downstream profiles must explicitly select each descriptor and grant each
capability. The repository's conversation-only profiles intentionally select
none of them.
