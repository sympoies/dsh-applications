# Telegram channel descriptor

This public package describes one reviewed external DSH channel artifact:
`@ashafizullah/dsh-telegram@0.5.1`. It is not a Telegram client and does not
copy, wrap, or execute the plugin. The exact npm tarball digest, source
revision, provenance endpoint, DSH compatibility, required conversation
capabilities, and bounded mediation classes are fixed in the descriptor.

The API surface is one factory,
`createTelegramChannelPluginDescriptor(runtimeKit)`. Runtime-kit remains the
canonical descriptor and digest owner. The caller supplies no artifact or
configuration values, so it cannot replace the reviewed bytes or widen the
public contract.

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

Compatibility is exact DSH `0.1.1-rc.2`, runtime-kit contract `0.0.0`, plugin
API `1.0.0`, and Linux x64. Repository owner tests verify the external identity,
disabled composition, descriptor digest, schema digest, and public/private
boundary.
