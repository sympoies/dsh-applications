# Conversation agent contracts

This public package validates one conversation turn and its reply for the
`conversational` profile. Message text is untrusted data. The package holds no
channel client, ingress, credential, secret locator, private topology, or
deployment binding: reaching a chat and delivering a reply stay adapter-owned
in the private deployment.

A turn is a bounded message plus an optional channel context. That context is
three fields — `chatRef`, `senderRef`, and `isGroup` — and the two refs are
opaque deployment-scoped `ref:<sha256>` digests. The adapter that owns the real
chat and account identifiers resolves them into refs before the turn is
admitted, so no channel identifier, handle, phone number, or address can reach
this contract, the model, or session memory. Distinct chats and participants
stay distinguishable, which is all an agent needs to scope memory per chat and
tell participants apart in a group. Validation rejects a raw identifier, a
partial context, and any extra field, so a plaintext identifier cannot ride
along as an unvalidated property.

The channel context is optional because a direct one-to-one message carries no
group semantics. When it is present, all three fields are required: a partial
context is an error rather than a silent default.

`createConversationAgentPluginDescriptor` turns an admitted immutable
coordinated-release digest, source revision, and attestation identity into the
exact `runtime.sympoies.dev/v1` descriptor for `conversation-agent`. Runtime-kit
computes and validates the descriptor digest. The package fixes its action
schemas, compatibility, empty filesystem/network/subprocess/credential
mediation, empty tool set, and health probe; a caller cannot use the
artifact-identity input to widen them.

The agent loop, sessions, memory storage, and model routing belong to DSH and
the runtime-kit manager. This package only states the shape of what crosses the
boundary.
