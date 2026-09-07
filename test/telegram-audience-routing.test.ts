import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  TELEGRAM_AUDIENCE_BINDING_SCHEMA_DIGEST,
  createTelegramAudienceRouter,
} from "../packages/telegram-channel/src/index.ts";

const root = resolve(import.meta.dirname, "..");
const TEST_SCOPE_KEY = "public-test-only-scope-key";
const ref = (seed: string) => `ref:${createHmac("sha256", TEST_SCOPE_KEY).update(seed).digest("hex")}`;
const digest = (seed: string) => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    bindingRef: ref("binding"),
    eventRef: ref("event"),
    scopeRef: ref("scope-a"),
    audienceRole: "primary-conversation",
    conversationRef: ref("conversation-a"),
    participantRef: ref("participant-a"),
    conversationClass: "private",
    addressing: { mentionedBot: false, repliesToBot: false },
    ...overrides,
  };
}

function bindingFor(input: ReturnType<typeof envelope>, overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    admissionSealDigest: digest("admission-seal"),
    bindingDigest: digest("audience-binding"),
    assertionRef: ref(`assertion:${String(input.eventRef)}`),
    bindingRef: input.bindingRef,
    eventRef: input.eventRef,
    scopeRef: input.scopeRef,
    audienceRole: input.audienceRole,
    conversationRef: input.conversationRef,
    participantRef: input.participantRef,
    participantAuthorized: true,
    conversationAdmitted: true,
    behavior: input.conversationClass === "private" ? "private-dm" : "group-mentioned",
    modelRouteClass: "conversation-bounded",
    modelRouteRef: ref("model-route-default"),
    ambientContext: input.conversationClass === "private"
      ? null
      : { retentionSeconds: 3_600, maxMessages: 40, maxCharacters: 32_000 },
    ...overrides,
  };
}

function authority(resolveBinding = (input: ReturnType<typeof envelope>) => bindingFor(input)) {
  const consumed = new Set<string>();
  return {
    async authorize(request: ReturnType<typeof envelope>) {
      return resolveBinding(request);
    },
    async consume(request: { assertionRef: string }) {
      if (consumed.has(request.assertionRef)) return { accepted: false };
      consumed.add(request.assertionRef);
      return { accepted: true };
    },
  };
}

test("an authenticated exact private audience dispatches without group addressing", async () => {
  const router = createTelegramAudienceRouter(authority());
  const result = await router.admit(envelope());

  assert.equal(result.decision, "dispatch");
  assert.equal(result.behavior, "private-dm");
  assert.equal(result.audienceRole, "primary-conversation");
  assert.equal(result.ambientContext, null);
  assert.match(result.sessionKey, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.modelRoute, {
    class: "conversation-bounded",
    selectionRef: ref("model-route-default"),
    isolationKey: result.modelRoute.isolationKey,
  });
  assert.match(result.modelRoute.isolationKey, /^sha256:[0-9a-f]{64}$/u);
});

test("participant authorization and exact conversation admission are independent gates", async () => {
  const deniedBinding = createTelegramAudienceRouter(authority(() => ({ allowed: false }) as ReturnType<typeof bindingFor>));
  assert.deepEqual(await deniedBinding.admit(envelope()), {
    decision: "deny",
    code: "binding-denied",
  });

  const deniedParticipant = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    participantAuthorized: false,
  })));
  assert.deepEqual(await deniedParticipant.admit(envelope()), {
    decision: "deny",
    code: "participant-denied",
  });

  const unboundConversation = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    conversationAdmitted: false,
  })));
  assert.deepEqual(await unboundConversation.admit(envelope()), {
    decision: "deny",
    code: "conversation-denied",
  });

  const allowedParticipantWrongChat = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    conversationRef: ref("some-other-conversation"),
  })));
  assert.deepEqual(await allowedParticipantWrongChat.admit(envelope()), {
    decision: "deny",
    code: "binding-mismatch",
  });
});

test("one authority supports mention-gated and free-response groups with reply continuation", async () => {
  const owner = authority(input => bindingFor(input, {
    behavior: input.audienceRole === "announcements" ? "group-mentioned" : "group-free-response",
  }));
  const router = createTelegramAudienceRouter(owner);
  const mentionedGroup = envelope({
    eventRef: ref("mention-event"),
    audienceRole: "announcements",
    conversationRef: ref("mention-group"),
    conversationClass: "group",
  });
  const freeGroup = envelope({
    bindingRef: ref("same-bot-binding"),
    eventRef: ref("free-event"),
    audienceRole: "collaboration",
    conversationRef: ref("free-group"),
    conversationClass: "group",
  });

  const ignored = await router.admit(mentionedGroup);
  assert.equal(ignored.decision, "ignore");
  assert.equal(ignored.code, "mention-required");
  assert.deepEqual(ignored.ambientContext, {
    retentionSeconds: 3_600,
    maxMessages: 40,
    maxCharacters: 32_000,
  });

  const mentioned = await router.admit({
    ...mentionedGroup,
    eventRef: ref("addressed-event"),
    addressing: { mentionedBot: true, repliesToBot: false },
  });
  assert.equal(mentioned.decision, "dispatch");
  assert.equal(mentioned.behavior, "group-mentioned");

  const continuation = await router.admit({
    ...mentionedGroup,
    eventRef: ref("reply-event"),
    addressing: { mentionedBot: false, repliesToBot: true },
  });
  assert.equal(continuation.decision, "dispatch");
  assert.equal(continuation.behavior, "group-mentioned");

  const free = await router.admit(freeGroup);
  assert.equal(free.decision, "dispatch");
  assert.equal(free.behavior, "group-free-response");
});

test("missing, extra, swapped, wrong-audience, and replayed bindings fail closed", async () => {
  const missingEnvelope = envelope() as Record<string, unknown>;
  delete missingEnvelope.bindingRef;
  assert.deepEqual(await createTelegramAudienceRouter(authority()).admit(missingEnvelope), {
    decision: "deny",
    code: "envelope-invalid",
  });

  const missing = createTelegramAudienceRouter(authority(input => {
    const { bindingDigest: _missing, ...binding } = bindingFor(input);
    return binding as ReturnType<typeof bindingFor>;
  }));
  assert.deepEqual(await missing.admit(envelope()), { decision: "deny", code: "binding-invalid" });

  const extra = createTelegramAudienceRouter(authority(input => bindingFor(input, { rawChat: "forbidden" })));
  assert.deepEqual(await extra.admit(envelope()), { decision: "deny", code: "binding-invalid" });

  for (const mismatch of [
    { scopeRef: ref("scope-b") },
    { audienceRole: "another-audience" },
    { conversationRef: ref("conversation-b") },
    { participantRef: ref("participant-b") },
    { bindingRef: ref("binding-b") },
    { eventRef: ref("event-b") },
  ]) {
    const swapped = createTelegramAudienceRouter(authority(input => bindingFor(input, mismatch)));
    assert.deepEqual(await swapped.admit(envelope()), { decision: "deny", code: "binding-mismatch" });
  }

  const replayRouter = createTelegramAudienceRouter(authority());
  assert.equal((await replayRouter.admit(envelope())).decision, "dispatch");
  assert.deepEqual(await replayRouter.admit(envelope()), { decision: "deny", code: "binding-replayed" });
});

test("session and model-route keys are isolated across DM, group, and deployment scope", async () => {
  const router = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    behavior: input.conversationClass === "private" ? "private-dm" : "group-free-response",
  })));
  const dm = await router.admit(envelope({ eventRef: ref("dm-event") }));
  const group = await router.admit(envelope({
    eventRef: ref("group-event"),
    audienceRole: "collaboration",
    conversationRef: ref("group-conversation"),
    conversationClass: "group",
  }));
  const anotherScope = await router.admit(envelope({
    eventRef: ref("scope-event"),
    scopeRef: ref("scope-b"),
  }));

  assert.equal(dm.decision, "dispatch");
  assert.equal(group.decision, "dispatch");
  assert.equal(anotherScope.decision, "dispatch");
  assert.equal(new Set([dm.sessionKey, group.sessionKey, anotherScope.sessionKey]).size, 3);
  assert.equal(new Set([
    dm.modelRoute.isolationKey,
    group.modelRoute.isolationKey,
    anotherScope.modelRoute.isolationKey,
  ]).size, 3);
});

test("untrusted envelope shapes, owner failures, and over-ceiling ambient context deny", async () => {
  const router = createTelegramAudienceRouter(authority());
  assert.deepEqual(await router.admit({ ...envelope(), rawChat: "forbidden" }), {
    decision: "deny",
    code: "envelope-invalid",
  });
  assert.deepEqual(await router.admit({ ...envelope(), bindingRef: "123456" }), {
    decision: "deny",
    code: "envelope-invalid",
  });

  const unavailable = createTelegramAudienceRouter({
    async authorize() { throw new Error("private detail must not escape"); },
    async consume() { return { accepted: true }; },
  });
  assert.deepEqual(await unavailable.admit(envelope()), { decision: "deny", code: "authority-unavailable" });

  const excessive = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    behavior: "group-free-response",
    ambientContext: { retentionSeconds: 604_801, maxMessages: 40, maxCharacters: 32_000 },
  })));
  assert.deepEqual(await excessive.admit(envelope({ conversationClass: "group" })), {
    decision: "deny",
    code: "binding-invalid",
  });

  const widenedModelClass = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    modelRouteClass: "open-world-model",
  })));
  assert.deepEqual(await widenedModelClass.admit(envelope({ eventRef: ref("widened-model-event") })), {
    decision: "deny",
    code: "binding-invalid",
  });

  let conversationReads = 0;
  const accessorSwap = createTelegramAudienceRouter(authority(input => {
    const result = bindingFor(input);
    Object.defineProperty(result, "conversationRef", {
      enumerable: true,
      get() {
        conversationReads += 1;
        return conversationReads === 1 ? input.conversationRef : "raw-channel-identifier";
      },
    });
    return result;
  }));
  assert.equal((await accessorSwap.admit(envelope({ eventRef: ref("accessor-event") }))).decision, "dispatch");
  assert.equal(conversationReads, 1, "validated binding fields are captured exactly once");
});

test("the published audience schema is exact, portable, and bound to the source constant", () => {
  const schemaPath = resolve(root, "packages/telegram-channel/schemas/audience-binding.schema.json");
  const source = readFileSync(schemaPath, "utf8");
  assert.equal(
    TELEGRAM_AUDIENCE_BINDING_SCHEMA_DIGEST,
    `sha256:${createHash("sha256").update(source).digest("hex")}`,
  );
  assert.doesNotMatch(source, /(?:^|[^a-z])(?:chat|user|sender)[_-]?id(?:[^a-z]|$)/iu);
  assert.doesNotMatch(source, /tokenRef|credentialRef|secretRef|providerEndpoint|\/home\//u);
});
