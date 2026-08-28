# DSH rc2 adapter

This package is the only direct DeepSeek Harness `0.1.1-rc.2` integration
surface. It uses public agent create/resume handles, cancellation, idle and
flush checkpoints. Cold resume first checks the public persistence list and
inspection, then delegates reconstruction to `agents.resume`. The configured
agent scope must expose the DSH register/restrict/guard/execute tool surface;
the DSH-owned sandbox handle performs plugin execution through that scope. Each
instance supplies distinct runtime roots, sessions, memory, queues,
credential-handle sets, budgets, and concurrency controllers.

The adapter accepts plugin work only through an enforced DSH sandbox handle
whose agent scope installs a monotonic tool guard and inherited-tool
restriction. It does not implement a JavaScript sandbox or a second agent
loop. Private runtime resolution is injected and is never included in a public
manager result or receipt.
