# DSH rc2 adapter

This package is the only direct DeepSeek Harness `0.1.1-rc.2` integration
surface. It uses public agent create/resume handles, cancellation, idle and
flush checkpoints. Cold resume authenticates the one requested persisted
session with a point inspection, then delegates reconstruction to
`agents.resume`. The configured
agent scope must expose the DSH register/restrict/guard/execute tool surface;
the DSH-owned sandbox handle performs plugin execution through that scope. Each
instance supplies distinct runtime roots, sessions, memory, queues,
credential-handle sets, budgets, and concurrency controllers.

The adapter accepts plugin work only through an enforced DSH sandbox handle
whose agent scope installs a monotonic tool guard and inherited-tool
restriction. It does not implement a JavaScript sandbox or a second agent
loop. Invocation-scoped host capabilities are revoked before in-flight
accounting drains. Teardown retains phase completion until binding release and
handle disposal both succeed, so stop and stale retirement can retry without
repeating completed effects or losing ownership. Private runtime resolution is
injected and is never included in a public manager result or receipt.
