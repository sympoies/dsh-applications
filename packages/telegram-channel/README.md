# Telegram channel descriptor

This public package describes one reviewed external DSH channel artifact:
`@ashafizullah/dsh-telegram@0.5.1`. It is not a Telegram client and does not
copy, wrap, or execute the plugin. The exact npm tarball digest, source
revision, provenance endpoint, DSH compatibility, required conversation
capabilities, and bounded mediation classes are fixed in the descriptor.

The transport-descriptor API is
`createTelegramChannelPluginDescriptor(runtimeKit)`. Runtime-kit remains the
canonical descriptor and digest owner. The caller supplies no artifact or
configuration values, so it cannot replace the reviewed bytes or widen the
public contract.

The same package also exports `createTelegramAudienceRouter(authorityOwner)`.
It is the public, channel-admission contract placed in front of agent dispatch;
it is not another Telegram client or authority engine. The deployment owner
resolves real Telegram updates into keyed opaque refs, authenticates the
binding, and atomically consumes its single-use assertion. The router then:

- checks exact scope, event, binding, audience-role, conversation, and
  participant correspondence;
- keeps participant authorization separate from conversation admission;
- selects `private-dm`, `group-mentioned`, or `group-free-response` behavior;
- treats both an explicit mention and a reply to the bot as group addressing;
- enforces group ambient-context maxima of seven days, 200 messages, and
  131,072 characters; and
- derives isolated session and model-route keys from opaque scope and
  conversation inputs.

The authenticated result shape is pinned by
`schemas/audience-binding.schema.json` and
`TELEGRAM_AUDIENCE_BINDING_SCHEMA_DIGEST`. The envelope deliberately contains
no model choice: only the authenticated deployment result supplies an opaque
`modelRouteRef`, and its `modelRouteClass` must remain the profile's public
`conversation-bounded` ceiling. A missing, malformed, mismatched, denied, already-consumed,
or authority-unavailable binding returns a fail-closed decision. A
mention-gated but otherwise admitted group message returns an `ignore` decision
with only its bounded context policy, so addressing remains distinct from
access control.

The public configuration fixes the channel at `enabled: false` and explicitly
turns off attachment ingestion, OCR, and screen capture. The companion DSH
profile also mounts the plugin with `disabled: true`. A private deployment must
independently verify and admit the exact artifact before it may supply its
credential reference, access bindings, isolated workspace, conversation-only
agent preset, and enablement patch. Those private values never enter this
descriptor, the public profile, or a public composition lock.

When admitted, the channel may use only an instance-state filesystem class,
the Telegram API network class, and a Telegram bot credential-handle class. It
requires the public `conversation.memory` and `conversation.reply`
capabilities, exposes no agent tool or skill, and grants no project workspace,
shell, or ambient network authority. DSH continues to own agents, sessions,
credentials, and the agent loop; runtime-kit owns authority intersection,
admission, lifecycle, isolation, and receipts.

The adopted transport's raw `allowFrom` and global
`requireMentionInGroups` settings are not substitutes for this contract: they
cannot prove an admitted conversation or express mixed group behavior. A
private integration must run the public router against its authenticated site
binding before agent dispatch and may narrow, but never exceed, the public
ambient-context ceiling. The public router keeps no replay database or mutable
session state; those stay with the deployment/runtime owner.

Attachment ingestion, vision/OCR, screen capture, and Telegram location
handling remain outside this profile. Their separately reviewed follow-up is
[issue #28](https://github.com/sympoies/dsh-applications/issues/28).

Compatibility is exact DSH `0.1.1-rc.2`, runtime-kit contract `0.0.0`, plugin
API `1.0.0`, and Linux x64. Repository owner tests verify the external identity,
disabled composition, descriptor digest, schema digest, and public/private
boundary. The companion native fragment commits its complete npm graph and is
installed only with `npm ci --ignore-scripts`.
