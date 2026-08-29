# Public bot profile catalog

Each directory contains one runtime-kit `BotProfile`, its public instructions,
and bounded input/output schemas. A profile declares a public authority ceiling;
it does not install plugins or grant any runtime authority by itself.

Private deployment bindings, project/channel/provider identities, credentials,
traffic state, service configuration, and machine paths are deliberately absent.
Infrastructure intersects each profile with reviewed plugin requirements, public
runtime policy, and an immutable private admission seal before execution.

The batch profile contains both manual and schedule triggers. Scheduling is
therefore reusable trigger configuration, not a second persona or authority
document.
