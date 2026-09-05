import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CONVERSATION_REPLY_SCHEMA_DIGEST,
  CONVERSATION_TURN_SCHEMA_DIGEST,
  createConversationAgentPluginDescriptor,
  validateConversationReply,
  validateConversationTurn,
} from "../packages/conversation-agent/src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const exactRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactRuntimeKitAvailable = existsSync(join(exactRoot, "src/composition/index.js"));
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const profile = json("profiles/conversational/profile.json");

const digestFile = (path: string) =>
  `sha256:${createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")}`;

// A conforming ref is a KEYED digest: a bare hash of a low-entropy channel
// identifier is exhaustively invertible, so the fixture models the required
// construction rather than normalizing an unsalted one.
const DEPLOYMENT_SECRET = "test-deployment-secret";
const ref = (seed: string) => `ref:${createHmac("sha256", DEPLOYMENT_SECRET).update(seed).digest("hex")}`;

const turn = (overrides = {}) => ({ message: "hello", ...overrides });

test("a conversation turn carries a message and an optional neutral channel context", () => {
  // The bare direct-message shape stays valid: channel context is additive.
  assert.deepEqual(validateConversationTurn(turn()), { message: "hello" });

  const group = turn({
    channel: { chatRef: ref("chat-1"), senderRef: ref("sender-1"), isGroup: true },
  });
  const validated = validateConversationTurn(group);
  assert(validated.channel !== undefined);
  assert.equal(validated.channel.isGroup, true);
  assert.equal(validated.channel.chatRef, ref("chat-1"));
  assert.equal(Object.isFrozen(validated), true, "a validated turn is immutable");

  // Distinct chats and senders stay distinguishable, which is all the agent
  // needs to scope memory and tell participants apart.
  assert.notEqual(ref("chat-1"), ref("chat-2"));
});

test("a conversation turn refuses every real channel identifier", () => {
  // The public contract must never carry a raw chat id, handle, phone number,
  // or e-mail: the private adapter resolves those into opaque refs.
  for (const identifier of [
    "-1001234567890",
    "1234567890",
    "@example-handle",
    "example-handle",
    "someone@example.com",
    "+15550100000",
    "ref:not-hex",
    `ref:${"a".repeat(63)}`,
    `ref:${"A".repeat(64)}`,
    `REF:${"a".repeat(64)}`,
    `ref:${"a".repeat(65)}`,
    "",
  ]) {
    assert.throws(
      () => validateConversationTurn(turn({
        channel: { chatRef: identifier, senderRef: ref("sender-1"), isGroup: false },
      })),
      TypeError,
      `chatRef must reject ${JSON.stringify(identifier)}`,
    );
    assert.throws(
      () => validateConversationTurn(turn({
        channel: { chatRef: ref("chat-1"), senderRef: identifier, isGroup: false },
      })),
      TypeError,
      `senderRef must reject ${JSON.stringify(identifier)}`,
    );
  }
});

test("a conversation turn rejects malformed envelopes", () => {
  assert.throws(() => validateConversationTurn(null), TypeError);
  assert.throws(() => validateConversationTurn([]), TypeError);
  assert.throws(() => validateConversationTurn({}), TypeError, "message is required");
  assert.throws(() => validateConversationTurn(turn({ extra: 1 })), TypeError, "unknown field");
  assert.throws(() => validateConversationTurn({ message: "" }), TypeError, "empty message");
  assert.throws(
    () => validateConversationTurn({ message: "x".repeat(16_385) }),
    TypeError,
    "oversized message",
  );
  // A partial channel context is an error, not a silent default.
  assert.throws(
    () => validateConversationTurn(turn({ channel: { chatRef: ref("chat-1") } })),
    TypeError,
    "senderRef and isGroup are required with a channel",
  );
  assert.throws(
    () => validateConversationTurn(turn({
      channel: { chatRef: ref("c"), senderRef: ref("s"), isGroup: "yes" },
    })),
    TypeError,
    "isGroup must be a boolean",
  );
  assert.throws(
    () => validateConversationTurn(turn({
      channel: { chatRef: ref("c"), senderRef: ref("s"), isGroup: false, displayName: "Example Name" },
    })),
    TypeError,
    "no personal display name may ride along",
  );
});

test("an accessor cannot swap a validated ref for a raw identifier", () => {
  // The returned document must be built from the values that were checked, not
  // re-read from caller-owned memory, or a getter could pass the ref check and
  // then place a raw chat id into the result.
  let reads = 0;
  const validated = validateConversationTurn({
    message: "hello",
    channel: {
      get chatRef() {
        reads += 1;
        return reads === 1 ? ref("chat-1") : "-1001234567890";
      },
      senderRef: ref("sender-1"),
      isGroup: false,
    },
  });
  assert(validated.channel !== undefined);
  assert.equal(validated.channel.chatRef, ref("chat-1"));

  let messageReads = 0;
  const swapped = validateConversationTurn({
    get message() {
      messageReads += 1;
      return messageReads === 1 ? "hello" : "x".repeat(20_000);
    },
  });
  assert.equal(swapped.message, "hello");
});

test("text bounds count code points, matching the published maxLength", () => {
  // JSON Schema maxLength counts code points, so text the digest-pinned schema
  // admits must not be rejected here for being multi-byte.
  const cjk = "漢";
  assert.equal(validateConversationTurn({ message: cjk.repeat(6000) }).message.length, 6000);
  assert.equal(validateConversationReply({ reply: cjk.repeat(6000) }).reply.length, 6000);
  assert.throws(() => validateConversationTurn({ message: cjk.repeat(16_385) }), TypeError);
  assert.throws(() => validateConversationReply({ reply: cjk.repeat(16_385) }), TypeError);

  // An astral character is one code point but two UTF-16 units, so a naive
  // .length bound would reject a conforming payload.
  assert.equal(validateConversationTurn({ message: "\u{1F600}".repeat(16_384) }).message.length, 32_768);
  assert.throws(() => validateConversationTurn({ message: "\u{1F600}".repeat(16_385) }), TypeError);
});

test("a conversation reply carries only bounded reply text", () => {
  assert.deepEqual(validateConversationReply({ reply: "hi" }), { reply: "hi" });
  assert.equal(Object.isFrozen(validateConversationReply({ reply: "hi" })), true);
  assert.throws(() => validateConversationReply({}), TypeError);
  assert.throws(() => validateConversationReply({ reply: "" }), TypeError);
  assert.throws(() => validateConversationReply({ reply: "x".repeat(16_385) }), TypeError);
  assert.throws(() => validateConversationReply({ reply: "hi", chatRef: ref("c") }), TypeError);
});

test("the published schema digests match the schema files on disk", () => {
  assert.equal(
    CONVERSATION_TURN_SCHEMA_DIGEST,
    digestFile("packages/conversation-agent/schemas/turn.schema.json"),
  );
  assert.equal(
    CONVERSATION_REPLY_SCHEMA_DIGEST,
    digestFile("packages/conversation-agent/schemas/reply.schema.json"),
  );
  // The profile's message trigger is bound to the same turn contract.
  assert.equal(
    digestFile("profiles/conversational/input.schema.json"),
    profile.artifacts.inputSchemaDigest,
  );
  assert.equal(profile.triggers[0].inputSchemaDigest, profile.artifacts.inputSchemaDigest);
});

test("the descriptor claims no filesystem, network, subprocess, or credential authority", {
  skip: !exactRuntimeKitAvailable,
}, async () => {
  const runtimeKit = await import(pathToFileURL(join(exactRoot, "src/composition/index.js")).href);
  const descriptor: any = createConversationAgentPluginDescriptor(runtimeKit, {
    digest: `sha256:${"4".repeat(64)}`,
    sourceRevision: "3".repeat(40),
    attestationIdentity: `https://github.com/sympoies/dsh-applications/actions@${"3".repeat(40)}`,
  });

  assert.equal(descriptor.metadata.id, "conversation-agent");
  assert.equal(descriptor.artifact.package, "@sympoies/dsh-conversation-agent");
  assert.equal(descriptor.artifact.entrypoint, "packages/conversation-agent/src/index.ts");
  assert.equal(existsSync(resolve(root, descriptor.artifact.entrypoint)), true, "the descriptor entrypoint must be a shipped source file");
  assert.equal(descriptor.metadata.digest, runtimeKit.computeDocumentDigest(descriptor));
  assert.equal(Object.isFrozen(descriptor), true);
  for (const field of ["filesystem", "network", "subprocess", "credentialHandleClasses"]) {
    assert.deepEqual(descriptor.mediation[field], [], `${field} must stay empty`);
  }
  assert.deepEqual(descriptor.capabilities.tools, [], "a least-authority agent exposes no tools");
  for (const action of descriptor.actions) {
    assert.equal(action.sideEffect, "none");
    assert.equal(action.class, "read");
  }
  // The profile's declared health probe and plugin range must be satisfiable.
  assert(profile.requiredHealth.includes(descriptor.health.probes[0].id));
  const range = profile.plugins.find((plugin: any) => plugin.id === "conversation-agent")?.range;
  assert.equal(runtimeKit.versionSatisfies(descriptor.metadata.version, range), true,
    `descriptor version ${descriptor.metadata.version} must satisfy the profile range ${range}`);
});
