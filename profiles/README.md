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

The `telegram-conversational` profile adds the reviewed
`@ashafizullah/dsh-telegram@0.5.1` channel to the channel-neutral conversation
contract. Its native DSH insert row is shipped disabled; public configuration
also fixes attachment ingestion, OCR, and screen capture off. Private
infrastructure must verify the exact artifact identity and provide its own
admitted credential, access, isolated workspace, conversation-only agent
preset, host, and enablement bindings; none of those values is a public profile
input. The native fragment's own README documents its fail-closed installation
path; DSH plugin-management commands are intentionally excluded because they
register the upstream bundle as active composition.
