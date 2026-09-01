import { definePlugin } from "@sympoies/dsh-plugin-sdk";

export const CONVERSATION_TURN_SCHEMA_DIGEST = "sha256:69d1b82718feee19f825937a4e75357f6d0d4dc7bfc3ad27e62c7dde22a523a6";
export const CONVERSATION_REPLY_SCHEMA_DIGEST = "sha256:a155a7a633ac342aa6c2dd7411296222e6c38e88d9a6b4cc31dbea5d45b2351f";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

// A channel reference is an opaque, deployment-scoped digest. The adapter that
// owns the real chat and account identifiers resolves them into these refs, so
// no channel identifier, handle, phone number, or address can reach the public
// contract, model input, or session memory while chats and participants stay
// distinguishable enough to scope memory and address a group.
const CHANNEL_REF = /^ref:[0-9a-f]{64}$/u;

const MESSAGE_MAX_BYTES = 16_384;

function fail(message) {
  throw new TypeError(message);
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function boundedText(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  if (Buffer.byteLength(value, "utf8") > MESSAGE_MAX_BYTES) fail(`${label} is too long`);
}

function channelRef(value, label) {
  if (typeof value !== "string" || !CHANNEL_REF.test(value)) {
    fail(`${label} must be an opaque ref: digest, never a real channel identifier`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function freezeClone(value) {
  const clone = structuredClone(value);
  const freeze = candidate => {
    if (candidate !== null && typeof candidate === "object" && !Object.isFrozen(candidate)) {
      Object.values(candidate).forEach(freeze);
      Object.freeze(candidate);
    }
    return candidate;
  };
  return freeze(clone);
}

export function validateConversationTurn(input) {
  const value = record(input, "turn");
  exactKeys(value, ["message"], ["channel"], "turn");
  boundedText(value.message, "turn.message");
  if ("channel" in value) {
    const channel = record(value.channel, "turn.channel");
    exactKeys(channel, ["chatRef", "senderRef", "isGroup"], [], "turn.channel");
    channelRef(channel.chatRef, "turn.channel.chatRef");
    channelRef(channel.senderRef, "turn.channel.senderRef");
    if (typeof channel.isGroup !== "boolean") fail("turn.channel.isGroup must be a boolean");
  }
  return freezeClone(value);
}

export function validateConversationReply(input) {
  const value = record(input, "reply");
  exactKeys(value, ["reply"], [], "reply");
  boundedText(value.reply, "reply.reply");
  return freezeClone(value);
}

export function createConversationAgentPluginDescriptor(runtimeKit, artifactIdentity) {
  if (typeof runtimeKit?.computeDocumentDigest !== "function") {
    fail("runtime-kit computeDocumentDigest owner is required");
  }
  const artifact = record(artifactIdentity, "artifactIdentity");
  exactKeys(artifact, ["digest", "sourceRevision", "attestationIdentity"], [], "artifactIdentity");
  digest(artifact.digest, "artifactIdentity.digest");
  if (typeof artifact.sourceRevision !== "string" || !SOURCE_REVISION.test(artifact.sourceRevision)) {
    fail("artifactIdentity.sourceRevision must be an immutable revision");
  }
  boundedText(artifact.attestationIdentity, "artifactIdentity.attestationIdentity");

  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: { id: "conversation-agent", version: "0.3.0", digest: `sha256:${"0".repeat(64)}` },
    artifact: {
      package: "@sympoies/conversation-agent",
      digest: artifact.digest,
      entrypoint: "packages/conversation-agent/src/index.js",
      sourceRevision: artifact.sourceRevision,
      attestationIdentity: artifact.attestationIdentity,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"],
    },
    capabilities: {
      provides: ["conversation.memory", "conversation.reply"],
      requires: [], tools: [], skills: [], services: [], dependencies: [],
    },
    actions: [
      {
        id: "conversation.memory",
        class: "read",
        inputSchemaDigest: CONVERSATION_TURN_SCHEMA_DIGEST,
        outputSchemaDigest: CONVERSATION_TURN_SCHEMA_DIGEST,
        sideEffect: "none",
        idempotency: "supported",
        capability: "conversation.memory",
      },
      {
        id: "conversation.reply",
        class: "read",
        inputSchemaDigest: CONVERSATION_TURN_SCHEMA_DIGEST,
        outputSchemaDigest: CONVERSATION_REPLY_SCHEMA_DIGEST,
        sideEffect: "none",
        idempotency: "supported",
        capability: "conversation.reply",
      },
    ],
    configuration: { schemaDigest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", defaults: {} },
    mediation: {
      filesystem: [], network: [], subprocess: [], credentialHandleClasses: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
    },
    health: { probes: [{ id: "conversation-agent.ready", requirement: "required" }] },
    composition: {
      conflicts: [], cardinality: { min: 1, max: 1 },
      namespaceClaims: ["conversation.memory", "conversation.reply"],
      ordering: { before: [], after: [] },
    },
    lifecycle: {
      readiness: "required", interrupt: "supported", drain: "required",
      disposal: "required", recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = runtimeKit.computeDocumentDigest(descriptor);
  return definePlugin(runtimeKit, descriptor);
}
