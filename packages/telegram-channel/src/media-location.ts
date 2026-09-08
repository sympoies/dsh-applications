import { createHash } from "node:crypto";

import { definePlugin, type PluginDescriptor, type RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const TELEGRAM_MEDIA_LIMITS = Object.freeze({
  maxAttachments: 10,
  maxAlbumParts: 10,
  maxItemBytes: 20_971_520,
  maxTotalBytes: 20_971_520,
  maxTextCharacters: 60_000,
  maxCaptionCharacters: 1_024,
  maxImageDimension: 2_000,
  maxImagePixels: 4_000_000,
});

export const TELEGRAM_VISION_LIMITS = Object.freeze({
  maxImages: 10,
  maxInstructionCharacters: 4_096,
  maxResultCharacters: 16_384,
  maxTotalResultCharacters: 32_768,
});

export const TELEGRAM_LOCATION_LIMITS = Object.freeze({
  minimumLatitude: -90,
  maximumLatitude: 90,
  minimumLongitude: -180,
  maximumLongitude: 180,
  maximumHorizontalAccuracyMeters: 1_500,
});

export const TELEGRAM_CAPABILITY_BUNDLE_CEILING_DIGEST =
  "sha256:16dfe32f05a0730497d65c135a25e01044be8acd921139efb264757cc6cac80a";

export const TELEGRAM_INPUT_SCHEMA_DIGESTS = Object.freeze({
  "telegram.media.input": Object.freeze({
    input: "sha256:d0974fbb7fb8879ef4802cb1c1cc8380051a8e33cb2b5806bc32b517fd3d21b3",
    output: "sha256:9b8ec41510e7df2f89576e1e2f4b85582f14442dd8b8fcf69e3baa0769b31be6",
  }),
  "telegram.vision.inspect": Object.freeze({
    input: "sha256:0f92686e680ccc0437357d3c2673d66b6c65fe5cbda80b78af9515b1815877a3",
    output: "sha256:fee059984ba4d0e23750f71ff1deef00737656ee3f40a185a54914a6ec3c182a",
  }),
  "telegram.location.input": Object.freeze({
    input: "sha256:d65118b99cd423ab61995ecc083752b4c79775ca7aa7af760a598f05b9ff3eb4",
    output: "sha256:a35d12cc4c476bf70a46d561c1541417b2587dcb03ba14661bba5b6a6d02d2c4",
  }),
} as const);

export type TelegramInputActionId = keyof typeof TELEGRAM_INPUT_SCHEMA_DIGESTS;

export interface TelegramInputScope {
  readonly deploymentRef: string;
  readonly audienceRef: string;
  readonly conversationRef: string;
}

export interface TelegramInputContext<Action extends TelegramInputActionId> {
  readonly admittedAction: Action;
  readonly requestRef: string;
  readonly eventRef: string;
  readonly scope: TelegramInputScope;
}

export interface TelegramDigestedInputContext<Action extends TelegramInputActionId>
  extends TelegramInputContext<Action> {
  readonly inputDigest: string;
}

export interface TelegramVisionContext extends TelegramDigestedInputContext<"telegram.vision.inspect"> {
  readonly modelRouteRef: string;
  readonly imageRefs: readonly string[];
}

export interface TelegramMediaReceiptContext extends TelegramDigestedInputContext<"telegram.media.input"> {
  readonly attachmentRefs: readonly string[];
}

export interface TelegramContractArtifactIdentity {
  readonly digest: string;
  readonly sourceRevision: string;
  readonly attestationIdentity: string;
}

type Fields = Record<string, unknown>;

interface DescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): string;
}

const REF = /^ref:[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const TEXT_MIME = /^text\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const APPLICATION_TEXT_MIME_TYPES = new Set([
  "application/javascript", "application/json", "application/sql", "application/toml",
  "application/typescript", "application/x-yaml", "application/xml", "application/yaml",
]);
const SCOPE_KEYS = ["deploymentRef", "audienceRef", "conversationRef"] as const;

function fail(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) fail(`${label} has unknown symbol fields`);
  return value as Fields;
}

function exactKeys(value: Fields, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined
      || descriptor.enumerable !== true) {
      fail(`${label}.${key} must be plain JSON data`);
    }
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined
      || descriptor.enumerable !== true) {
      fail(`${label}.${key} must be plain JSON data`);
    }
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
}

function ownOptionalField(value: Fields, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
    fail(`${label}.${key} must be plain JSON data`);
  }
  return descriptor.value;
}

function opaqueRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !REF.test(value)) fail(`${label} must be an opaque deployment-scoped ref`);
}

function sha256Digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function boundedText(value: unknown, label: string, maximum: number, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    fail(`${label} is invalid or exceeds its character bound`);
  }
  let characters = 0;
  for (const _character of value) {
    characters += 1;
    if (characters > maximum) fail(`${label} is invalid or exceeds its character bound`);
  }
}

function boundedCharacterCount(value: string, maximum: number): number {
  let characters = 0;
  for (const _character of value) {
    characters += 1;
    if (characters > maximum) return characters;
  }
  return characters;
}

function boundedInteger(value: unknown, label: string, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} is out of range`);
  }
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)
    || value < minimum || value > maximum) {
    fail(`${label} is out of range`);
  }
}

function boundedArray(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail(`${label} must be a bounded array`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
    fail(`${label} must be plain JSON data`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "length") continue;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(key) || descriptor.get !== undefined
      || descriptor.set !== undefined || descriptor.enumerable !== true) {
      fail(`${label} must be plain JSON data`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) fail(`${label} must not be sparse`);
  }
  return value;
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

function contentDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(domain).update("\0").update(JSON.stringify(value)).digest("hex")}`;
}

function validatedScope(input: unknown, label: string): TelegramInputScope {
  const source = record(input, label);
  exactKeys(source, SCOPE_KEYS, [], label);
  const deploymentRef = source.deploymentRef;
  const audienceRef = source.audienceRef;
  const conversationRef = source.conversationRef;
  opaqueRef(deploymentRef, `${label}.deploymentRef`);
  opaqueRef(audienceRef, `${label}.audienceRef`);
  opaqueRef(conversationRef, `${label}.conversationRef`);
  return { deploymentRef, audienceRef, conversationRef };
}

function sameScope(actual: TelegramInputScope, expected: TelegramInputScope): boolean {
  return SCOPE_KEYS.every(key => actual[key] === expected[key]);
}

function validateContext<Action extends TelegramInputActionId>(
  input: unknown,
  action: Action,
  expected: unknown,
  options: { readonly digest?: string } = {},
): { value: Fields; requestRef: string; eventRef: string; scope: TelegramInputScope } {
  if (expected === null || typeof expected !== "object") fail("trusted context is required");
  const context = record(expected, "trusted context");
  const contextSpecific = action === "telegram.vision.inspect" ? ["modelRouteRef", "imageRefs"] : [];
  exactKeys(context, ["admittedAction", "requestRef", "eventRef", "scope", "inputDigest", ...contextSpecific], [], "trusted context");
  if (context.admittedAction !== action) fail("trusted context admitted action does not match the request action");
  sha256Digest(context.inputDigest, "trusted context.inputDigest");
  const expectedRequestRef = context.requestRef;
  const expectedEventRef = context.eventRef;
  opaqueRef(expectedRequestRef, "trusted context.requestRef");
  opaqueRef(expectedEventRef, "trusted context.eventRef");
  const expectedScope = validatedScope(context.scope, "trusted context.scope");

  const value = record(input, `${action} request`);
  const requestRef = value.requestRef;
  const eventRef = value.eventRef;
  opaqueRef(requestRef, `${action} request.requestRef`);
  opaqueRef(eventRef, `${action} request.eventRef`);
  const scope = validatedScope(value.scope, `${action} request.scope`);
  if (requestRef !== expectedRequestRef || eventRef !== expectedEventRef || !sameScope(scope, expectedScope)) {
    fail(`${action} trusted tuple binding mismatch`);
  }
  if (options.digest !== undefined) {
    const expectedDigest = context.inputDigest;
    if (options.digest !== expectedDigest) fail(`${action} input digest mismatch`);
  }
  return { value, requestRef, eventRef, scope };
}

function validateImageAttachment(source: Fields, label: string, kind: "photo" | "image-document") {
  exactKeys(source, ["kind", "attachmentRef", "mediaType", "bytes", "width", "height"], [], label);
  const attachmentRef = source.attachmentRef;
  const mediaType = source.mediaType;
  const bytes = source.bytes;
  const width = source.width;
  const height = source.height;
  opaqueRef(attachmentRef, `${label}.attachmentRef`);
  if (typeof mediaType !== "string" || !IMAGE_MIME_TYPES.has(mediaType)
    || (kind === "photo" && mediaType !== "image/jpeg")) fail(`${label}.mediaType is unsupported`);
  boundedInteger(bytes, `${label}.bytes`, TELEGRAM_MEDIA_LIMITS.maxItemBytes);
  boundedInteger(width, `${label}.width`, TELEGRAM_MEDIA_LIMITS.maxImageDimension);
  boundedInteger(height, `${label}.height`, TELEGRAM_MEDIA_LIMITS.maxImageDimension);
  if (width * height > TELEGRAM_MEDIA_LIMITS.maxImagePixels) fail(`${label} exceeds the image pixel bound`);
  return { kind, attachmentRef, mediaType, bytes, width, height } as const;
}

function validateTextAttachment(source: Fields, label: string) {
  exactKeys(source, ["kind", "attachmentRef", "mediaType", "bytes", "text", "truncated"], [], label);
  const attachmentRef = source.attachmentRef;
  const mediaType = source.mediaType;
  const bytes = source.bytes;
  const text = source.text;
  const truncated = source.truncated;
  opaqueRef(attachmentRef, `${label}.attachmentRef`);
  if (typeof mediaType !== "string" || (!TEXT_MIME.test(mediaType) && !APPLICATION_TEXT_MIME_TYPES.has(mediaType))) {
    fail(`${label}.mediaType is unsupported`);
  }
  boundedInteger(bytes, `${label}.bytes`, TELEGRAM_MEDIA_LIMITS.maxItemBytes);
  boundedText(text, `${label}.text`, TELEGRAM_MEDIA_LIMITS.maxTextCharacters, true);
  if (typeof truncated !== "boolean") fail(`${label}.truncated must be a boolean`);
  return { kind: "text-document" as const, attachmentRef, mediaType, bytes, text, truncated };
}

function normalizedMediaRequest(input: unknown) {
  const value = record(input, "telegram.media.input request");
  exactKeys(value, ["action", "requestRef", "eventRef", "scope", "mode", "attachments"], ["albumRef", "caption"], "telegram.media.input request");
  if (value.action !== "telegram.media.input") fail("telegram.media.input request action is unsupported");
  const requestRef = value.requestRef;
  const eventRef = value.eventRef;
  opaqueRef(requestRef, "telegram.media.input request.requestRef");
  opaqueRef(eventRef, "telegram.media.input request.eventRef");
  const scope = validatedScope(value.scope, "telegram.media.input request.scope");
  if (value.mode !== "single" && value.mode !== "album") fail("telegram.media.input request.mode is unsupported");
  const mode = value.mode;
  const albumRefValue = ownOptionalField(value, "albumRef", "telegram.media.input request");
  const caption = ownOptionalField(value, "caption", "telegram.media.input request");
  if (caption !== undefined) boundedText(caption, "telegram.media.input request.caption", TELEGRAM_MEDIA_LIMITS.maxCaptionCharacters, true);
  const rawAttachments = boundedArray(value.attachments, "telegram.media.input request.attachments", 1, TELEGRAM_MEDIA_LIMITS.maxAttachments);
  if (mode === "single" && (rawAttachments.length !== 1 || albumRefValue !== undefined)) {
    fail("a single media request must have one item and no album ref");
  }
  let albumRef: string | undefined;
  if (mode === "album") {
    if (rawAttachments.length < 2 || rawAttachments.length > TELEGRAM_MEDIA_LIMITS.maxAlbumParts) {
      fail("an album must remain within the album part bound");
    }
    albumRef = albumRefValue as string;
    opaqueRef(albumRef, "telegram.media.input request.albumRef");
  }
  const attachmentRefs = new Set<string>();
  let totalBytes = 0;
  let totalTextCharacters = 0;
  const attachments = rawAttachments.map((candidate, index) => {
    const source = record(candidate, `telegram.media.input request.attachments[${index}]`);
    const kind = source.kind;
    let attachment;
    if (kind === "photo" || kind === "image-document") attachment = validateImageAttachment(source, `telegram.media.input request.attachments[${index}]`, kind);
    else if (kind === "text-document") attachment = validateTextAttachment(source, `telegram.media.input request.attachments[${index}]`);
    else fail(`telegram.media.input request.attachments[${index}].kind is unsupported`);
    if (attachmentRefs.has(attachment.attachmentRef)) fail("telegram.media.input request attachment refs must be unique");
    attachmentRefs.add(attachment.attachmentRef);
    totalBytes += attachment.bytes;
    if (attachment.kind === "text-document") {
      totalTextCharacters += boundedCharacterCount(
        attachment.text,
        TELEGRAM_MEDIA_LIMITS.maxTextCharacters - totalTextCharacters,
      );
    }
    return attachment;
  });
  if (totalBytes > TELEGRAM_MEDIA_LIMITS.maxTotalBytes) fail("telegram.media.input request exceeds its total byte bound");
  if (totalTextCharacters > TELEGRAM_MEDIA_LIMITS.maxTextCharacters) fail("telegram.media.input request exceeds its total text bound");
  return {
    action: "telegram.media.input" as const, requestRef, eventRef, scope, mode,
    ...(albumRef === undefined ? {} : { albumRef }),
    ...(caption === undefined ? {} : { caption }),
    attachments,
  };
}

export function computeTelegramMediaInputDigest(input: unknown): string {
  const normalized = normalizedMediaRequest(input);
  const normalizedFields = normalized as Fields;
  const albumRef = ownOptionalField(normalizedFields, "albumRef", "normalized telegram.media.input request");
  const caption = ownOptionalField(normalizedFields, "caption", "normalized telegram.media.input request");
  return contentDigest("telegram-media-input-v1", {
    mode: normalized.mode,
    ...(albumRef === undefined ? {} : { albumRef }),
    ...(caption === undefined ? {} : { caption }),
    attachments: normalized.attachments,
  });
}

export function validateTelegramMediaInput(
  input: unknown,
  expected: TelegramDigestedInputContext<"telegram.media.input">,
): ReturnType<typeof normalizedMediaRequest> {
  const normalized = normalizedMediaRequest(input);
  validateContext(normalized, "telegram.media.input", expected, { digest: computeTelegramMediaInputDigest(normalized) });
  return freezeClone(normalized) as ReturnType<typeof normalizedMediaRequest>;
}

export function validateTelegramMediaReceipt(input: unknown, expected: TelegramMediaReceiptContext) {
  const value = record(input, "telegram.media.input receipt");
  exactKeys(value, [
    "action", "requestRef", "eventRef", "scope", "inputDigest", "status", "attachmentRefs",
  ], [], "telegram.media.input receipt");
  if (value.action !== "telegram.media.input") fail("telegram.media.input receipt action is unsupported");
  if (value.status !== "accepted") fail("telegram.media.input receipt status is unsupported");
  sha256Digest(value.inputDigest, "telegram.media.input receipt.inputDigest");
  const { attachmentRefs: expectedAttachmentRefs, ...baseExpected } = expected;
  const head = validateContext(value, "telegram.media.input", baseExpected, { digest: value.inputDigest });
  const rawAttachmentRefs = boundedArray(value.attachmentRefs, "telegram.media.input receipt.attachmentRefs", 1, TELEGRAM_MEDIA_LIMITS.maxAttachments);
  const attachmentRefs = rawAttachmentRefs.map((candidate, index) => {
    opaqueRef(candidate, `telegram.media.input receipt.attachmentRefs[${index}]`);
    return candidate;
  });
  const expectedRefs = boundedArray(expectedAttachmentRefs, "trusted context.attachmentRefs", 1, TELEGRAM_MEDIA_LIMITS.maxAttachments);
  expectedRefs.forEach((candidate, index) => opaqueRef(candidate, `trusted context.attachmentRefs[${index}]`));
  if (new Set(attachmentRefs).size !== attachmentRefs.length || attachmentRefs.length !== expectedRefs.length
    || attachmentRefs.some((candidate, index) => candidate !== expectedRefs[index])) {
    fail("telegram.media.input receipt attachment-ref binding mismatch");
  }
  return freezeClone({
    action: "telegram.media.input" as const,
    requestRef: head.requestRef,
    eventRef: head.eventRef,
    scope: head.scope,
    inputDigest: value.inputDigest,
    status: "accepted" as const,
    attachmentRefs,
  });
}

function normalizedVisionRequest(input: unknown) {
  const value = record(input, "telegram.vision.inspect request");
  exactKeys(value, ["action", "requestRef", "eventRef", "scope", "modelRouteRef", "imageRefs"], ["instruction"], "telegram.vision.inspect request");
  if (value.action !== "telegram.vision.inspect") fail("telegram.vision.inspect request action is unsupported");
  const requestRef = value.requestRef;
  const eventRef = value.eventRef;
  opaqueRef(requestRef, "telegram.vision.inspect request.requestRef");
  opaqueRef(eventRef, "telegram.vision.inspect request.eventRef");
  const scope = validatedScope(value.scope, "telegram.vision.inspect request.scope");
  const modelRouteRef = value.modelRouteRef;
  opaqueRef(modelRouteRef, "telegram.vision.inspect request.modelRouteRef");
  const rawImageRefs = boundedArray(value.imageRefs, "telegram.vision.inspect request.imageRefs", 1, TELEGRAM_VISION_LIMITS.maxImages);
  const imageRefs = rawImageRefs.map((candidate, index) => {
    opaqueRef(candidate, `telegram.vision.inspect request.imageRefs[${index}]`);
    return candidate;
  });
  if (new Set(imageRefs).size !== imageRefs.length) fail("telegram.vision.inspect request image refs must be unique");
  const instruction = ownOptionalField(value, "instruction", "telegram.vision.inspect request");
  if (instruction !== undefined) boundedText(instruction, "telegram.vision.inspect request.instruction", TELEGRAM_VISION_LIMITS.maxInstructionCharacters);
  return {
    action: "telegram.vision.inspect" as const,
    requestRef,
    eventRef,
    scope,
    modelRouteRef,
    imageRefs,
    ...(instruction === undefined ? {} : { instruction }),
  };
}

export function computeTelegramVisionInputDigest(input: unknown): string {
  return contentDigest("telegram-vision-input-v1", normalizedVisionRequest(input));
}

export function validateTelegramVisionRequest(input: unknown, expected: TelegramVisionContext) {
  const normalized = normalizedVisionRequest(input);
  validateContext(normalized, "telegram.vision.inspect", expected, {
    digest: computeTelegramVisionInputDigest(normalized),
  });
  opaqueRef(expected.modelRouteRef, "trusted context.modelRouteRef");
  const expectedImageRefs = boundedArray(expected.imageRefs, "trusted context.imageRefs", 1, TELEGRAM_VISION_LIMITS.maxImages);
  expectedImageRefs.forEach((candidate, index) => opaqueRef(candidate, `trusted context.imageRefs[${index}]`));
  if (normalized.modelRouteRef !== expected.modelRouteRef
    || normalized.imageRefs.length !== expectedImageRefs.length
    || normalized.imageRefs.some((candidate, index) => candidate !== expectedImageRefs[index])) {
    fail("telegram.vision.inspect model-route or image-ref binding mismatch");
  }
  return freezeClone(normalized);
}

export function validateTelegramVisionReceipt(input: unknown, expected: TelegramVisionContext) {
  const value = record(input, "telegram.vision.inspect receipt");
  exactKeys(value, [
    "action", "requestRef", "eventRef", "scope", "modelRouteRef", "status", "results",
  ], [], "telegram.vision.inspect receipt");
  if (value.action !== "telegram.vision.inspect") fail("telegram.vision.inspect receipt action is unsupported");
  if (value.status !== "completed") fail("telegram.vision.inspect receipt status is unsupported");
  const head = validateContext(value, "telegram.vision.inspect", expected);
  const modelRouteRef = value.modelRouteRef;
  opaqueRef(modelRouteRef, "telegram.vision.inspect receipt.modelRouteRef");
  if (modelRouteRef !== expected.modelRouteRef) fail("telegram.vision.inspect receipt model-route binding mismatch");
  const rawResults = boundedArray(value.results, "telegram.vision.inspect receipt.results", 1, TELEGRAM_VISION_LIMITS.maxImages);
  if (rawResults.length !== expected.imageRefs.length) fail("telegram.vision.inspect receipt image-ref binding mismatch");
  let totalCharacters = 0;
  const results = rawResults.map((candidate, index) => {
    const result = record(candidate, `telegram.vision.inspect receipt.results[${index}]`);
    exactKeys(result, ["imageRef", "text"], [], `telegram.vision.inspect receipt.results[${index}]`);
    const imageRef = result.imageRef;
    const text = result.text;
    opaqueRef(imageRef, `telegram.vision.inspect receipt.results[${index}].imageRef`);
    boundedText(text, `telegram.vision.inspect receipt.results[${index}].text`, TELEGRAM_VISION_LIMITS.maxResultCharacters, true);
    if (imageRef !== expected.imageRefs[index]) fail("telegram.vision.inspect receipt image-ref binding mismatch");
    totalCharacters += boundedCharacterCount(
      text,
      TELEGRAM_VISION_LIMITS.maxTotalResultCharacters - totalCharacters,
    );
    return { imageRef, text };
  });
  if (totalCharacters > TELEGRAM_VISION_LIMITS.maxTotalResultCharacters) {
    fail("telegram.vision.inspect receipt exceeds its total text bound");
  }
  return freezeClone({
    action: "telegram.vision.inspect" as const,
    requestRef: head.requestRef,
    eventRef: head.eventRef,
    scope: head.scope,
    modelRouteRef,
    status: "completed" as const,
    results,
  });
}

function normalizedLocationRequest(input: unknown) {
  const value = record(input, "telegram.location.input request");
  exactKeys(value, ["action", "requestRef", "eventRef", "scope", "location"], [], "telegram.location.input request");
  if (value.action !== "telegram.location.input") fail("telegram.location.input request action is unsupported");
  const requestRef = value.requestRef;
  const eventRef = value.eventRef;
  opaqueRef(requestRef, "telegram.location.input request.requestRef");
  opaqueRef(eventRef, "telegram.location.input request.eventRef");
  const scope = validatedScope(value.scope, "telegram.location.input request.scope");
  const location = record(value.location, "telegram.location.input request.location");
  exactKeys(location, ["kind", "latitude", "longitude"], ["horizontalAccuracyMeters"], "telegram.location.input request.location");
  if (location.kind !== "static") fail("telegram.location.input supports static location only");
  const latitude = location.latitude;
  const longitude = location.longitude;
  boundedNumber(latitude, "telegram.location.input request.location.latitude", TELEGRAM_LOCATION_LIMITS.minimumLatitude, TELEGRAM_LOCATION_LIMITS.maximumLatitude);
  boundedNumber(longitude, "telegram.location.input request.location.longitude", TELEGRAM_LOCATION_LIMITS.minimumLongitude, TELEGRAM_LOCATION_LIMITS.maximumLongitude);
  const horizontalAccuracyMeters = ownOptionalField(
    location,
    "horizontalAccuracyMeters",
    "telegram.location.input request.location",
  );
  if (horizontalAccuracyMeters !== undefined) {
    boundedNumber(horizontalAccuracyMeters, "telegram.location.input request.location.horizontalAccuracyMeters", 0, TELEGRAM_LOCATION_LIMITS.maximumHorizontalAccuracyMeters);
  }
  return {
    action: "telegram.location.input" as const, requestRef, eventRef, scope,
    location: {
      kind: "static" as const, latitude, longitude,
      ...(horizontalAccuracyMeters === undefined ? {} : { horizontalAccuracyMeters }),
    },
  };
}

export function computeTelegramLocationInputDigest(input: unknown): string {
  return contentDigest("telegram-location-input-v1", normalizedLocationRequest(input).location);
}

export function validateTelegramLocationInput(
  input: unknown,
  expected: TelegramDigestedInputContext<"telegram.location.input">,
): ReturnType<typeof normalizedLocationRequest> {
  const normalized = normalizedLocationRequest(input);
  validateContext(normalized, "telegram.location.input", expected, { digest: computeTelegramLocationInputDigest(normalized) });
  return freezeClone(normalized) as ReturnType<typeof normalizedLocationRequest>;
}

export function validateTelegramLocationReceipt(
  input: unknown,
  expected: TelegramDigestedInputContext<"telegram.location.input">,
) {
  const value = record(input, "telegram.location.input receipt");
  exactKeys(value, [
    "action", "requestRef", "eventRef", "scope", "inputDigest", "status", "location",
  ], [], "telegram.location.input receipt");
  if (value.action !== "telegram.location.input") fail("telegram.location.input receipt action is unsupported");
  if (value.status !== "accepted") fail("telegram.location.input receipt status is unsupported");
  sha256Digest(value.inputDigest, "telegram.location.input receipt.inputDigest");
  const normalized = normalizedLocationRequest({
    action: value.action,
    requestRef: value.requestRef,
    eventRef: value.eventRef,
    scope: value.scope,
    location: value.location,
  });
  const digest = computeTelegramLocationInputDigest(normalized);
  const head = validateContext(value, "telegram.location.input", expected, { digest });
  if (value.inputDigest !== digest) fail("telegram.location.input receipt input digest mismatch");
  return freezeClone({
    action: "telegram.location.input" as const,
    requestRef: head.requestRef,
    eventRef: head.eventRef,
    scope: head.scope,
    inputDigest: value.inputDigest,
    status: "accepted" as const,
    location: normalized.location,
  });
}

function validateArtifactIdentity(input: unknown): TelegramContractArtifactIdentity {
  const value = record(input, "artifactIdentity");
  exactKeys(value, ["digest", "sourceRevision", "attestationIdentity"], [], "artifactIdentity");
  sha256Digest(value.digest, "artifactIdentity.digest");
  if (typeof value.sourceRevision !== "string" || !SOURCE_REVISION.test(value.sourceRevision)) {
    fail("artifactIdentity.sourceRevision must be an immutable revision");
  }
  boundedText(value.attestationIdentity, "artifactIdentity.attestationIdentity", 1_024);
  return value as unknown as TelegramContractArtifactIdentity;
}

function createInputDescriptor(
  runtimeKit: unknown,
  artifactIdentity: unknown,
  spec: {
    readonly id: string;
    readonly action: TelegramInputActionId;
    readonly requires: readonly string[];
    readonly dependencies: readonly { readonly id: string; readonly range: string; readonly scope: "required" }[];
    readonly outputBytes?: number;
  },
): Readonly<PluginDescriptor> {
  const owner = runtimeKit as Partial<DescriptorOwner> | null | undefined;
  if (typeof owner?.computeDocumentDigest !== "function") fail("runtime-kit computeDocumentDigest owner is required");
  const artifact = validateArtifactIdentity(artifactIdentity);
  const schema = TELEGRAM_INPUT_SCHEMA_DIGESTS[spec.action];
  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: { id: spec.id, version: "0.6.0", digest: `sha256:${"0".repeat(64)}` },
    artifact: {
      package: "@sympoies/dsh-telegram-channel",
      digest: artifact.digest,
      entrypoint: "packages/telegram-channel/src/index.ts",
      sourceRevision: artifact.sourceRevision,
      attestationIdentity: artifact.attestationIdentity,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"],
    },
    capabilities: {
      provides: [spec.action], requires: [...spec.requires].sort(), tools: [], skills: [], services: [],
      dependencies: [...spec.dependencies],
    },
    actions: [{
      id: spec.action,
      class: "read",
      inputSchemaDigest: schema.input,
      outputSchemaDigest: schema.output,
      sideEffect: "none",
      idempotency: "supported",
      capability: spec.action,
    }],
    configuration: {
      schemaDigest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      defaults: {},
    },
    mediation: {
      filesystem: [], network: [], subprocess: [], credentialHandleClasses: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: spec.outputBytes ?? 65_536 },
    },
    health: { probes: [{ id: `${spec.id}.ready`, requirement: "required" }] },
    composition: {
      conflicts: [], cardinality: { min: 1, max: 1 }, namespaceClaims: [spec.action],
      ordering: { before: [], after: [] },
    },
    lifecycle: {
      readiness: "required", interrupt: "supported", drain: "required", disposal: "required", recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = owner.computeDocumentDigest(descriptor);
  return definePlugin(owner as DescriptorOwner, descriptor as unknown as PluginDescriptor);
}

export function createTelegramMediaInputPluginDescriptor(
  runtimeKit: unknown,
  artifactIdentity: TelegramContractArtifactIdentity,
): Readonly<PluginDescriptor>;
export function createTelegramMediaInputPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return createInputDescriptor(runtimeKit, artifactIdentity, {
    id: "telegram-media-input",
    action: "telegram.media.input",
    requires: ["channel.telegram.ingress"],
    dependencies: [{ id: "telegram-channel", range: "=0.5.1", scope: "required" }],
  });
}

export function createTelegramVisionPluginDescriptor(
  runtimeKit: unknown,
  artifactIdentity: TelegramContractArtifactIdentity,
): Readonly<PluginDescriptor>;
export function createTelegramVisionPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return createInputDescriptor(runtimeKit, artifactIdentity, {
    id: "telegram-vision",
    action: "telegram.vision.inspect",
    requires: ["telegram.media.input"],
    dependencies: [{ id: "telegram-media-input", range: ">=0.4.0 <1.0.0", scope: "required" }],
    outputBytes: 262_144,
  });
}

export function createTelegramLocationInputPluginDescriptor(
  runtimeKit: unknown,
  artifactIdentity: TelegramContractArtifactIdentity,
): Readonly<PluginDescriptor>;
export function createTelegramLocationInputPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return createInputDescriptor(runtimeKit, artifactIdentity, {
    id: "telegram-location-input",
    action: "telegram.location.input",
    requires: [],
    dependencies: [],
  });
}
