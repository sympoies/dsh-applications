export declare const CONVERSATION_TURN_SCHEMA_DIGEST: string;
export declare const CONVERSATION_REPLY_SCHEMA_DIGEST: string;

/**
 * An opaque, deployment-scoped reference to a chat or a participant, shaped as
 * `ref:<64 lowercase hex>`. The channel adapter resolves the real identifier
 * into this digest, so no channel identifier reaches the public contract, the
 * model, or session memory.
 *
 * It MUST be a keyed digest — `HMAC-SHA256(deployment secret, identifier)` or
 * equivalent. A bare digest of a low-entropy identifier such as a numeric chat
 * id or a phone number is exhaustively invertible and therefore
 * non-conforming. Only the shape can be validated here; minting the ref
 * correctly is the adapter's obligation.
 */
export type ChannelRef = string;

export interface ConversationChannelContext {
  readonly chatRef: ChannelRef;
  readonly senderRef: ChannelRef;
  readonly isGroup: boolean;
}

export interface ConversationTurn {
  readonly message: string;
  readonly channel?: ConversationChannelContext;
}

export interface ConversationReply {
  readonly reply: string;
}

export interface ArtifactIdentity {
  readonly digest: string;
  readonly sourceRevision: string;
  readonly attestationIdentity: string;
}

export declare function validateConversationTurn(input: unknown): ConversationTurn;
export declare function validateConversationReply(input: unknown): ConversationReply;
export declare function createConversationAgentPluginDescriptor(
  runtimeKit: unknown,
  artifactIdentity: ArtifactIdentity,
): unknown;
