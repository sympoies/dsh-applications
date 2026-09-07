import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  TELEGRAM_AUDIENCE_BINDING_SCHEMA_DIGEST,
  TELEGRAM_AUTHORITY_TIMEOUT_CEILING_MILLISECONDS,
  createTelegramAudienceRouter,
  type TelegramAudienceAuthorizationResult,
  type TelegramAudienceAuthorityContext,
  type TelegramAudienceConsumptionReceipt,
  type TelegramAudienceConsumptionRequest,
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
  const allowed: true = true;
  const behavior: "private-dm" | "group-mentioned" = input.conversationClass === "private"
    ? "private-dm"
    : "group-mentioned";
  const modelRouteClass: "conversation-bounded" = "conversation-bounded";
  return {
    allowed,
    admissionSealDigest: digest("admission-seal"),
    bindingDigest: digest("audience-binding"),
    assertionRef: ref(`assertion:${String(input.eventRef)}`),
    bindingRef: input.bindingRef,
    eventRef: input.eventRef,
    scopeRef: input.scopeRef,
    audienceRole: input.audienceRole,
    conversationRef: input.conversationRef,
    participantRef: input.participantRef,
    addressing: input.addressing,
    participantAuthorized: true,
    conversationAdmitted: true,
    behavior,
    modelRouteClass,
    modelRouteRef: ref("model-route-default"),
    ambientContext: input.conversationClass === "private"
      ? null
      : { retentionSeconds: 3_600, maxMessages: 40, maxCharacters: 32_000 },
    ...overrides,
  };
}

const deniedAuthorization: TelegramAudienceAuthorizationResult = { allowed: false };
const acceptedConsumption: TelegramAudienceConsumptionReceipt = { accepted: true };

function authority(
  resolveBinding: (input: ReturnType<typeof envelope>) => TelegramAudienceAuthorizationResult = input => bindingFor(input),
  consumeBinding?: (
    request: Readonly<TelegramAudienceConsumptionRequest>,
    context: Readonly<TelegramAudienceAuthorityContext>,
  ) => TelegramAudienceConsumptionReceipt | Promise<TelegramAudienceConsumptionReceipt>,
) {
  const consumed = new Set<string>();
  return {
    timeoutMilliseconds: 250,
    async authorize(request: ReturnType<typeof envelope>) {
      return resolveBinding(request);
    },
    async consume(
      request: Readonly<TelegramAudienceConsumptionRequest>,
      context: Readonly<TelegramAudienceAuthorityContext>,
    ) {
      if (consumeBinding) return consumeBinding(request, context);
      if (consumed.has(request.assertionRef)) return { accepted: false };
      consumed.add(request.assertionRef);
      return acceptedConsumption;
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
  const deniedBinding = createTelegramAudienceRouter(authority(() => deniedAuthorization));
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

test("authenticated addressing must exactly match the transport envelope", async () => {
  const trustedUnaddressed = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    addressing: { mentionedBot: false, repliesToBot: false },
  })));
  const alteredEnvelope = envelope({
    conversationClass: "group",
    addressing: { mentionedBot: true, repliesToBot: false },
  });

  assert.deepEqual(await trustedUnaddressed.admit(alteredEnvelope), {
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

test("consumption receives the complete authenticated replay tuple and exact receipts", async () => {
  const input = envelope({ eventRef: ref("consume-tuple-event") });
  let consumedRequest: Readonly<TelegramAudienceConsumptionRequest> | undefined;
  const router = createTelegramAudienceRouter(authority(
    request => bindingFor(request),
    request => {
      consumedRequest = request;
      return acceptedConsumption;
    },
  ));

  assert.equal((await router.admit(input)).decision, "dispatch");
  assert.equal(Object.isFrozen(consumedRequest), true);
  assert.deepEqual(consumedRequest, {
    scopeRef: input.scopeRef,
    eventRef: input.eventRef,
    assertionRef: ref(`assertion:${String(input.eventRef)}`),
    bindingDigest: digest("audience-binding"),
    admissionSealDigest: digest("admission-seal"),
  });

  const replayed = createTelegramAudienceRouter(authority(
    request => bindingFor(request),
    () => ({ accepted: false }),
  ));
  assert.deepEqual(await replayed.admit(envelope({ eventRef: ref("receipt-replay") })), {
    decision: "deny",
    code: "binding-replayed",
  });

  const malformedReceipt = { accepted: true, trace: "forbidden" };
  const malformed = createTelegramAudienceRouter(authority(
    request => bindingFor(request),
    () => malformedReceipt,
  ));
  assert.deepEqual(await malformed.admit(envelope({ eventRef: ref("receipt-malformed") })), {
    decision: "deny",
    code: "authority-unavailable",
  });
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

test("session and model-route isolation vary one authenticated boundary at a time", async () => {
  const router = createTelegramAudienceRouter(authority(input => bindingFor(input, {
    behavior: input.conversationClass === "private" ? "private-dm" : "group-free-response",
  })));
  const participantA = await router.admit(envelope({
    eventRef: ref("participant-a-event"),
    participantRef: ref("pairwise-participant-a"),
  }));
  const participantB = await router.admit(envelope({
    eventRef: ref("participant-b-event"),
    participantRef: ref("pairwise-participant-b"),
  }));
  const conversationA = await router.admit(envelope({
    eventRef: ref("conversation-a-event"),
    conversationClass: "group",
    conversationRef: ref("pairwise-conversation-a"),
  }));
  const conversationB = await router.admit(envelope({
    eventRef: ref("conversation-b-event"),
    conversationClass: "group",
    conversationRef: ref("pairwise-conversation-b"),
  }));

  assert.equal(participantA.decision, "dispatch");
  assert.equal(participantB.decision, "dispatch");
  assert.notEqual(participantA.sessionKey, participantB.sessionKey);
  assert.equal(participantA.modelRoute.isolationKey, participantB.modelRoute.isolationKey);
  assert.equal(conversationA.decision, "dispatch");
  assert.equal(conversationB.decision, "dispatch");
  assert.notEqual(conversationA.modelRoute.isolationKey, conversationB.modelRoute.isolationKey);
});

test("authority deadlines and caller cancellation abort both owner callbacks", async () => {
  let authorizeSignal: AbortSignal | undefined;
  const authorizeTimeout = createTelegramAudienceRouter({
    timeoutMilliseconds: 10,
    authorize(_request, context) {
      authorizeSignal = context.signal;
      return new Promise(() => {});
    },
    async consume() {
      return acceptedConsumption;
    },
  });
  assert.deepEqual(await authorizeTimeout.admit(envelope()), {
    decision: "deny",
    code: "authority-unavailable",
  });
  assert.equal(authorizeSignal?.aborted, true);

  let consumeSignal: AbortSignal | undefined;
  let reportConsumeStarted!: () => void;
  const consumeStarted = new Promise<void>(resolveStarted => {
    reportConsumeStarted = resolveStarted;
  });
  const consumeTimeout = createTelegramAudienceRouter(authority(
    request => bindingFor(request),
    (_request, context) => {
      consumeSignal = context.signal;
      reportConsumeStarted();
      return new Promise(() => {});
    },
  ));
  const cancellation = new AbortController();
  const pending = consumeTimeout.admit(
    envelope({ eventRef: ref("cancelled-consume-event") }),
    { signal: cancellation.signal },
  );
  await consumeStarted;
  cancellation.abort(new Error("caller cancelled"));
  assert.deepEqual(await pending, { decision: "deny", code: "authority-unavailable" });
  assert.notEqual(consumeSignal, cancellation.signal, "owner receives a derived admission signal");
  assert.equal(consumeSignal?.aborted, true);

  assert.throws(
    () => createTelegramAudienceRouter({ ...authority(), timeoutMilliseconds: 0 }),
    /timeoutMilliseconds/u,
  );
  assert.throws(
    () => createTelegramAudienceRouter({
      ...authority(),
      timeoutMilliseconds: TELEGRAM_AUTHORITY_TIMEOUT_CEILING_MILLISECONDS + 1,
    }),
    /timeoutMilliseconds/u,
  );
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
    timeoutMilliseconds: 250,
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
  const schema = JSON.parse(source) as {
    oneOf: Array<{ properties: Record<string, unknown>; required: string[] }>;
  };
  assert.equal(schema.oneOf.length, 2);
  assert.deepEqual(schema.oneOf[0]?.required, ["allowed"]);
  assert.deepEqual(schema.oneOf[0]?.properties.allowed, { const: false });
  assert.deepEqual(schema.oneOf[1]?.properties.allowed, { const: true });
  assert.ok("addressing" in schema.oneOf[1]!.properties);
});
