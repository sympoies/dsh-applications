import { createHash } from "node:crypto";

import { definePlugin, type PluginDescriptor, type RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const TELEGRAM_PLUGIN_VERSION = "0.5.1";
export const TELEGRAM_PLUGIN_TARBALL_DIGEST = "sha256:a41aa5300eb0b0a25b33c162e843955eac8450c8a71446ba5c7f68623b61ea4b";
export const TELEGRAM_PLUGIN_SOURCE_REVISION = "596ef74b4fb9536aaae9981035240be4ef8a9acd";
export const TELEGRAM_PLUGIN_ATTESTATION = "https://github.com/ashafizullah/dsh-telegram/.github/workflows/release.yml@refs/tags/v0.5.1";
export const TELEGRAM_PUBLIC_CONFIG_SCHEMA_DIGEST = "sha256:91b024d728e80f3b9a75aff52de1a9dbba5b0c0db42f1a9bcd90bc81970a734f";
export const TELEGRAM_AUDIENCE_BINDING_SCHEMA_DIGEST = "sha256:11de0fe0b9cda7fbeef4cd0cb93599b3ef3bada6387927c4614ff8672765bf68";

export const TELEGRAM_AMBIENT_CONTEXT_CEILING = Object.freeze({
  retentionSeconds: 604_800,
  maxMessages: 200,
  maxCharacters: 131_072,
});
export const TELEGRAM_MODEL_ROUTE_CLASS = "conversation-bounded";

export type TelegramAudienceBehavior = "private-dm" | "group-mentioned" | "group-free-response";
export type TelegramConversationClass = "private" | "group";

export interface TelegramAudienceEnvelope {
  readonly bindingRef: string;
  readonly eventRef: string;
  readonly scopeRef: string;
  readonly audienceRole: string;
  readonly conversationRef: string;
  readonly participantRef: string;
  readonly conversationClass: TelegramConversationClass;
  readonly addressing: {
    readonly mentionedBot: boolean;
    readonly repliesToBot: boolean;
  };
}

export interface TelegramAmbientContextPolicy {
  readonly retentionSeconds: number;
  readonly maxMessages: number;
  readonly maxCharacters: number;
}

export interface AuthenticatedTelegramAudienceBinding {
  readonly allowed: true;
  readonly admissionSealDigest: string;
  readonly bindingDigest: string;
  readonly assertionRef: string;
  readonly bindingRef: string;
  readonly eventRef: string;
  readonly scopeRef: string;
  readonly audienceRole: string;
  readonly conversationRef: string;
  readonly participantRef: string;
  readonly participantAuthorized: boolean;
  readonly conversationAdmitted: boolean;
  readonly behavior: TelegramAudienceBehavior;
  readonly modelRouteClass: typeof TELEGRAM_MODEL_ROUTE_CLASS;
  readonly modelRouteRef: string;
  readonly ambientContext: TelegramAmbientContextPolicy | null;
}

export interface TelegramAudienceAuthorityOwner {
  authorize(request: Readonly<TelegramAudienceEnvelope>): unknown | Promise<unknown>;
  consume(request: Readonly<{
    scopeRef: string;
    eventRef: string;
    assertionRef: string;
    bindingDigest: string;
    admissionSealDigest: string;
  }>): unknown | Promise<unknown>;
}

export type TelegramAudienceDecision =
  | Readonly<{
    decision: "deny";
    code:
      | "envelope-invalid"
      | "authority-unavailable"
      | "binding-denied"
      | "binding-invalid"
      | "binding-mismatch"
      | "participant-denied"
      | "conversation-denied"
      | "binding-replayed";
  }>
  | Readonly<{
    decision: "ignore";
    code: "mention-required";
    audienceRole: string;
    sessionKey: string;
    ambientContext: TelegramAmbientContextPolicy;
  }>
  | Readonly<{
    decision: "dispatch";
    behavior: TelegramAudienceBehavior;
    audienceRole: string;
    sessionKey: string;
    modelRoute: Readonly<{
      class: typeof TELEGRAM_MODEL_ROUTE_CLASS;
      selectionRef: string;
      isolationKey: string;
    }>;
    ambientContext: TelegramAmbientContextPolicy | null;
  }>;

export interface TelegramAudienceRouter {
  admit(input: unknown): Promise<TelegramAudienceDecision>;
}

interface DescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): string;
}

function fail(message: string): never {
  throw new TypeError(message);
}

type Fields = Record<string, unknown>;

const OPAQUE_REF = /^ref:[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PUBLIC_IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;

function record(value: unknown, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  return value as Fields;
}

function exactKeys(value: Fields, required: readonly string[], label: string): void {
  const expected = new Set(required);
  for (const key of Object.keys(value)) if (!expected.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function opaqueRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !OPAQUE_REF.test(value)) fail(`${label} must be an opaque ref`);
}

function sha256Digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) fail(`${label} must be a sha256 digest`);
}

function publicIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !PUBLIC_IDENTIFIER.test(value)) fail(`${label} must be a public identifier`);
}

function boolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
}

function boundedPositiveInteger(value: unknown, label: string, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} is out of range`);
  }
}

function freezeClone<T>(value: T): Readonly<T> {
  const clone = structuredClone(value);
  const freeze = <Candidate>(candidate: Candidate): Candidate => {
    if (candidate !== null && typeof candidate === "object" && !Object.isFrozen(candidate)) {
      Object.values(candidate).forEach(freeze);
      Object.freeze(candidate);
    }
    return candidate;
  };
  return freeze(clone);
}

function validateAudienceEnvelope(input: unknown): Readonly<TelegramAudienceEnvelope> {
  const source = record(input, "envelope");
  exactKeys(source, [
    "bindingRef", "eventRef", "scopeRef", "audienceRole", "conversationRef",
    "participantRef", "conversationClass", "addressing",
  ], "envelope");
  const bindingRef = source.bindingRef;
  const eventRef = source.eventRef;
  const scopeRef = source.scopeRef;
  const audienceRole = source.audienceRole;
  const conversationRef = source.conversationRef;
  const participantRef = source.participantRef;
  const conversationClass = source.conversationClass;
  opaqueRef(bindingRef, "envelope.bindingRef");
  opaqueRef(eventRef, "envelope.eventRef");
  opaqueRef(scopeRef, "envelope.scopeRef");
  publicIdentifier(audienceRole, "envelope.audienceRole");
  opaqueRef(conversationRef, "envelope.conversationRef");
  opaqueRef(participantRef, "envelope.participantRef");
  if (conversationClass !== "private" && conversationClass !== "group") {
    fail("envelope.conversationClass is unsupported");
  }
  const addressingSource = record(source.addressing, "envelope.addressing");
  exactKeys(addressingSource, ["mentionedBot", "repliesToBot"], "envelope.addressing");
  const mentionedBot = addressingSource.mentionedBot;
  const repliesToBot = addressingSource.repliesToBot;
  boolean(mentionedBot, "envelope.addressing.mentionedBot");
  boolean(repliesToBot, "envelope.addressing.repliesToBot");
  return freezeClone({
    bindingRef, eventRef, scopeRef, audienceRole, conversationRef, participantRef,
    conversationClass, addressing: { mentionedBot, repliesToBot },
  });
}

function validateAmbientContext(input: unknown): Readonly<TelegramAmbientContextPolicy> {
  const source = record(input, "binding.ambientContext");
  exactKeys(source, ["retentionSeconds", "maxMessages", "maxCharacters"], "binding.ambientContext");
  const retentionSeconds = source.retentionSeconds;
  const maxMessages = source.maxMessages;
  const maxCharacters = source.maxCharacters;
  boundedPositiveInteger(retentionSeconds, "binding.ambientContext.retentionSeconds", TELEGRAM_AMBIENT_CONTEXT_CEILING.retentionSeconds);
  boundedPositiveInteger(maxMessages, "binding.ambientContext.maxMessages", TELEGRAM_AMBIENT_CONTEXT_CEILING.maxMessages);
  boundedPositiveInteger(maxCharacters, "binding.ambientContext.maxCharacters", TELEGRAM_AMBIENT_CONTEXT_CEILING.maxCharacters);
  return freezeClone({ retentionSeconds, maxMessages, maxCharacters });
}

function validateAudienceBinding(input: unknown): Readonly<AuthenticatedTelegramAudienceBinding> | null {
  const source = record(input, "binding");
  const allowed = source.allowed;
  if (allowed === false) {
    exactKeys(source, ["allowed"], "binding");
    return null;
  }
  exactKeys(source, [
    "allowed", "admissionSealDigest", "bindingDigest", "assertionRef", "bindingRef",
    "eventRef", "scopeRef", "audienceRole", "conversationRef", "participantRef",
    "participantAuthorized", "conversationAdmitted", "behavior", "modelRouteClass",
    "modelRouteRef", "ambientContext",
  ], "binding");
  if (allowed !== true) fail("binding.allowed must be a boolean decision");
  const admissionSealDigest = source.admissionSealDigest;
  const bindingDigest = source.bindingDigest;
  const assertionRef = source.assertionRef;
  const bindingRef = source.bindingRef;
  const eventRef = source.eventRef;
  const scopeRef = source.scopeRef;
  const audienceRole = source.audienceRole;
  const conversationRef = source.conversationRef;
  const participantRef = source.participantRef;
  const participantAuthorized = source.participantAuthorized;
  const conversationAdmitted = source.conversationAdmitted;
  const behavior = source.behavior;
  const modelRouteClass = source.modelRouteClass;
  const modelRouteRef = source.modelRouteRef;
  sha256Digest(admissionSealDigest, "binding.admissionSealDigest");
  sha256Digest(bindingDigest, "binding.bindingDigest");
  opaqueRef(assertionRef, "binding.assertionRef");
  opaqueRef(bindingRef, "binding.bindingRef");
  opaqueRef(eventRef, "binding.eventRef");
  opaqueRef(scopeRef, "binding.scopeRef");
  publicIdentifier(audienceRole, "binding.audienceRole");
  opaqueRef(conversationRef, "binding.conversationRef");
  opaqueRef(participantRef, "binding.participantRef");
  boolean(participantAuthorized, "binding.participantAuthorized");
  boolean(conversationAdmitted, "binding.conversationAdmitted");
  if (behavior !== "private-dm" && behavior !== "group-mentioned" && behavior !== "group-free-response") {
    fail("binding.behavior is unsupported");
  }
  if (modelRouteClass !== TELEGRAM_MODEL_ROUTE_CLASS) fail("binding.modelRouteClass exceeds the public ceiling");
  opaqueRef(modelRouteRef, "binding.modelRouteRef");
  const ambientContextSource = source.ambientContext;
  const ambientContext = ambientContextSource === null ? null : validateAmbientContext(ambientContextSource);
  if (behavior === "private-dm" && ambientContext !== null) fail("a private DM cannot retain ambient group context");
  if (behavior !== "private-dm" && ambientContext === null) fail("a group binding requires bounded ambient context");
  return freezeClone({
    allowed: true, admissionSealDigest, bindingDigest, assertionRef, bindingRef,
    eventRef, scopeRef, audienceRole, conversationRef, participantRef,
    participantAuthorized, conversationAdmitted, behavior, modelRouteClass, modelRouteRef, ambientContext,
  });
}

function isolatedDigest(domain: string, values: readonly string[]): string {
  return `sha256:${createHash("sha256").update([domain, ...values].join("\0")).digest("hex")}`;
}

function deny(code: Extract<TelegramAudienceDecision, { decision: "deny" }>["code"]): TelegramAudienceDecision {
  return freezeClone({ decision: "deny", code });
}

/**
 * Bind a transport-neutral Telegram envelope to the deployment authority that
 * authenticated it. The owner supplies private binding and replay state; this
 * package only validates the exact opaque result, enforces the public ceiling,
 * and derives isolated dispatch keys.
 */
export function createTelegramAudienceRouter(authorityOwner: TelegramAudienceAuthorityOwner): TelegramAudienceRouter;
export function createTelegramAudienceRouter(authorityOwner: unknown): TelegramAudienceRouter {
  const owner = authorityOwner as Partial<TelegramAudienceAuthorityOwner> | null | undefined;
  const authorize = owner?.authorize;
  const consume = owner?.consume;
  if (typeof authorize !== "function" || typeof consume !== "function") {
    fail("Telegram audience authority owner is required");
  }
  return Object.freeze({
    async admit(input: unknown): Promise<TelegramAudienceDecision> {
      let envelope: Readonly<TelegramAudienceEnvelope>;
      try {
        envelope = validateAudienceEnvelope(input);
      } catch {
        return deny("envelope-invalid");
      }

      let authorization: unknown;
      try {
        authorization = await authorize.call(owner, envelope);
      } catch {
        return deny("authority-unavailable");
      }

      let binding: Readonly<AuthenticatedTelegramAudienceBinding> | null;
      try {
        binding = validateAudienceBinding(authorization);
      } catch {
        return deny("binding-invalid");
      }
      if (binding === null) return deny("binding-denied");

      if (binding.bindingRef !== envelope.bindingRef
        || binding.eventRef !== envelope.eventRef
        || binding.scopeRef !== envelope.scopeRef
        || binding.audienceRole !== envelope.audienceRole
        || binding.conversationRef !== envelope.conversationRef
        || binding.participantRef !== envelope.participantRef) {
        return deny("binding-mismatch");
      }
      if ((envelope.conversationClass === "private" && binding.behavior !== "private-dm")
        || (envelope.conversationClass === "group" && binding.behavior === "private-dm")) {
        return deny("binding-mismatch");
      }
      if (!binding.participantAuthorized) return deny("participant-denied");
      if (!binding.conversationAdmitted) return deny("conversation-denied");

      let accepted: unknown;
      try {
        accepted = await consume.call(owner, freezeClone({
          scopeRef: binding.scopeRef,
          eventRef: binding.eventRef,
          assertionRef: binding.assertionRef,
          bindingDigest: binding.bindingDigest,
          admissionSealDigest: binding.admissionSealDigest,
        }));
        const receipt = record(accepted, "consumption");
        exactKeys(receipt, ["accepted"], "consumption");
        const acceptedValue = receipt.accepted;
        boolean(acceptedValue, "consumption.accepted");
        accepted = acceptedValue;
      } catch {
        return deny("authority-unavailable");
      }
      if (accepted !== true) return deny("binding-replayed");

      const sessionKey = isolatedDigest("telegram-session-v1", [
        binding.scopeRef,
        envelope.conversationClass,
        binding.conversationRef,
        ...(envelope.conversationClass === "private" ? [binding.participantRef] : []),
      ]);
      if (binding.behavior === "group-mentioned"
        && !envelope.addressing.mentionedBot
        && !envelope.addressing.repliesToBot) {
        return freezeClone({
          decision: "ignore",
          code: "mention-required",
          audienceRole: binding.audienceRole,
          sessionKey,
          ambientContext: binding.ambientContext!,
        });
      }
      return freezeClone({
        decision: "dispatch",
        behavior: binding.behavior,
        audienceRole: binding.audienceRole,
        sessionKey,
        modelRoute: {
          class: binding.modelRouteClass,
          selectionRef: binding.modelRouteRef,
          isolationKey: isolatedDigest("telegram-model-route-v1", [
            binding.scopeRef,
            binding.audienceRole,
            binding.conversationRef,
            binding.modelRouteClass,
            binding.modelRouteRef,
          ]),
        },
        ambientContext: binding.ambientContext,
      });
    },
  });
}

/**
 * Build the runtime-kit descriptor for the one reviewed external Telegram
 * artifact. No caller-controlled value can replace its package, version,
 * digest, source revision, mediation classes, or disabled public default.
 */
export function createTelegramChannelPluginDescriptor(runtimeKit: unknown): unknown {
  const owner = runtimeKit as Partial<DescriptorOwner> | null | undefined;
  if (typeof owner?.computeDocumentDigest !== "function") {
    fail("runtime-kit computeDocumentDigest owner is required");
  }

  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: {
      id: "telegram-channel",
      version: TELEGRAM_PLUGIN_VERSION,
      digest: `sha256:${"0".repeat(64)}`,
    },
    artifact: {
      package: "@ashafizullah/dsh-telegram",
      digest: TELEGRAM_PLUGIN_TARBALL_DIGEST,
      entrypoint: "lib/index.js",
      sourceRevision: TELEGRAM_PLUGIN_SOURCE_REVISION,
      attestationIdentity: TELEGRAM_PLUGIN_ATTESTATION,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2",
      runtimeKit: "=0.0.0",
      pluginApi: "=1.0.0",
      platforms: ["linux-x64"],
    },
    capabilities: {
      provides: ["channel.telegram.ingress", "channel.telegram.reply"],
      requires: ["conversation.memory", "conversation.reply"],
      tools: [],
      skills: [],
      services: ["dsh.agents", "dsh.credentials"],
      dependencies: [{ id: "conversation-agent", range: ">=0.3.0 <1.0.0", scope: "required" }],
    },
    actions: [],
    configuration: {
      schemaDigest: TELEGRAM_PUBLIC_CONFIG_SCHEMA_DIGEST,
      defaults: {
        enabled: false,
        media: { enabled: false, ocr: { enabled: false } },
        screenshot: { enabled: false },
      },
    },
    mediation: {
      filesystem: ["instance-state"],
      network: ["telegram-api"],
      subprocess: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
      credentialHandleClasses: ["telegram-bot-token"],
    },
    health: { probes: [{ id: "telegram-channel.ready", requirement: "required" }] },
    composition: {
      conflicts: [],
      cardinality: { min: 1, max: 1 },
      namespaceClaims: ["channel.telegram"],
      ordering: { before: [], after: ["conversation-agent"] },
    },
    lifecycle: {
      readiness: "required",
      interrupt: "supported",
      drain: "required",
      disposal: "required",
      recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = owner.computeDocumentDigest(descriptor);
  return definePlugin(owner as RuntimeKitPluginValidator, descriptor as unknown as PluginDescriptor);
}
