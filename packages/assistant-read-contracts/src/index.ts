import { Buffer } from "node:buffer";
import { isIP } from "node:net";

import { definePlugin, type JsonValue, type PluginDescriptor, type RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const ASSISTANT_READ_CAPABILITY_IDS = Object.freeze([
  "assistant.weather.lookup",
  "assistant.market.lookup",
  "assistant.steam.catalog.lookup",
  "assistant.web.lookup",
  "assistant.research.recent-community",
  "assistant.research.taiwan-public-discussion",
] as const);

export type AssistantReadCapabilityId = typeof ASSISTANT_READ_CAPABILITY_IDS[number];
export type AssistantReadTerminalStatus = "completed" | "cancelled" | "timed-out";

export interface AssistantReadCapabilityContract {
  readonly id: AssistantReadCapabilityId;
  readonly pluginId: string;
  readonly actionId: string;
  readonly schemaStem: string;
  readonly inputSchemaDigest: `sha256:${string}`;
  readonly outputSchemaDigest: `sha256:${string}`;
  readonly hostActionClasses: readonly ["provider-read"];
  readonly networkClasses: readonly [string];
  readonly budgets: Readonly<{
    inputBytes: number;
    outputBytes: number;
    timeoutMs: number;
    sources: number;
  }>;
  readonly cancellation: "required";
  readonly freshness: "required";
}

export interface AssistantReadAdmission {
  readonly admissionId: string;
  readonly capabilityId: AssistantReadCapabilityId;
  readonly implementationDigest: `sha256:${string}`;
  readonly bindingDigest: `sha256:${string}`;
  readonly audienceRefs: readonly string[];
  readonly limits: Readonly<{
    inputBytes: number;
    outputBytes: number;
    timeoutMs: number;
    sources: number;
  }>;
}

export interface AssistantReadInvocation {
  readonly capabilityId: AssistantReadCapabilityId;
  readonly requestId: string;
  readonly implementationDigest: `sha256:${string}`;
  readonly audienceRef: string;
  readonly input: JsonValue;
  readonly control: Readonly<{
    timeoutMs: number;
    maxOutputBytes: number;
    maxSources: number;
    cancellationRef: string;
  }>;
}

export interface AuthorizedAssistantReadInvocation {
  readonly capabilityId: AssistantReadCapabilityId;
  readonly requestId: string;
  readonly admissionId: string;
  readonly implementationDigest: `sha256:${string}`;
  readonly bindingDigest: `sha256:${string}`;
  readonly audienceRef: string;
  readonly input: JsonValue;
  readonly control: AssistantReadInvocation["control"];
}

export interface AssistantReadSource {
  readonly url: string;
  readonly title: string;
  readonly retrievedAt: string;
  readonly publishedAt?: string;
  readonly contentDigest: `sha256:${string}`;
}

export interface AssistantReadResult {
  readonly status: AssistantReadTerminalStatus;
  readonly asOf: string | null;
  readonly summary: string;
  readonly sources: readonly AssistantReadSource[];
  readonly data: JsonValue | null;
}

export interface ImmutableAssistantReadArtifactIdentity {
  readonly digest: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly attestationIdentity: string;
}

interface DescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): `sha256:${string}`;
}

type Fields = Record<string, unknown>;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const COUNTRY = /^[A-Z]{2}$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const CONFIG_SCHEMA_DIGEST = "sha256:38b8c506be2495292e2ad894e044b5ab83e31df2bb190a9665d645f831748c41";

export const ASSISTANT_READ_TRANSPORT_REQUIREMENTS = Object.freeze({
  rawBytesBeforeDecode: "required",
  decodedValueValidation: "required",
} as const);

export const WEB_EXTRACT_TARGET_POLICY = Object.freeze({
  protocols: Object.freeze(["http:", "https:"] as const),
  credentialedUrls: "forbidden",
  literalAddresses: "forbidden",
  dnsResolution: "all-addresses-public-before-connect",
  redirects: "revalidate-each-hop",
  maxRedirects: 5,
} as const);

const contracts: Record<AssistantReadCapabilityId, AssistantReadCapabilityContract> = {
  "assistant.weather.lookup": {
    id: "assistant.weather.lookup",
    pluginId: "assistant-weather-read",
    actionId: "assistant.weather.lookup",
    schemaStem: "weather",
    inputSchemaDigest: "sha256:9ab7c92dbea779baa66b36bd39279c2b4d3d9a54ee0f63e0650bbee61281663c",
    outputSchemaDigest: "sha256:ce0feceece3caff517386514db23f3cca06150e83dddb854590f2ae95f7c5d75",
    hostActionClasses: ["provider-read"],
    networkClasses: ["public-weather-data"],
    budgets: { inputBytes: 2_048, outputBytes: 32_768, timeoutMs: 10_000, sources: 4 },
    cancellation: "required",
    freshness: "required",
  },
  "assistant.market.lookup": {
    id: "assistant.market.lookup",
    pluginId: "assistant-market-read",
    actionId: "assistant.market.lookup",
    schemaStem: "market",
    inputSchemaDigest: "sha256:32c4b14dc09cddeecce3ff22aff2ebf68e9b6501515ea6ddea99c0274b3e1f94",
    outputSchemaDigest: "sha256:ad3c0a097216e6b1b2faa74fad89fffde6fe2408f5ea9db46dd0ee9252087ecb",
    hostActionClasses: ["provider-read"],
    networkClasses: ["public-market-data"],
    budgets: { inputBytes: 4_096, outputBytes: 49_152, timeoutMs: 12_000, sources: 8 },
    cancellation: "required",
    freshness: "required",
  },
  "assistant.steam.catalog.lookup": {
    id: "assistant.steam.catalog.lookup",
    pluginId: "assistant-steam-catalog-read",
    actionId: "assistant.steam.catalog.lookup",
    schemaStem: "steam",
    inputSchemaDigest: "sha256:c5bfb3e707461fec4b687b0f3fbfd0dc9b31fca319d55990bbb5cd00fcce7396",
    outputSchemaDigest: "sha256:4cde06c9eee1694855a7d936df385bd139cd1dc3404b7c09ec47080376390ecc",
    hostActionClasses: ["provider-read"],
    networkClasses: ["public-steam-catalog"],
    budgets: { inputBytes: 4_096, outputBytes: 65_536, timeoutMs: 12_000, sources: 8 },
    cancellation: "required",
    freshness: "required",
  },
  "assistant.web.lookup": {
    id: "assistant.web.lookup",
    pluginId: "assistant-web-read",
    actionId: "assistant.web.lookup",
    schemaStem: "web",
    inputSchemaDigest: "sha256:2b353dc15f558607ad9ff44dd0e2a2ad3ce8e502628f99893db96c545641ee20",
    outputSchemaDigest: "sha256:c94eb6ac3908022092a8203ee3673081168585972d8c189d202a5219276e31c8",
    hostActionClasses: ["provider-read"],
    networkClasses: ["public-web-data"],
    budgets: { inputBytes: 8_192, outputBytes: 131_072, timeoutMs: 30_000, sources: 12 },
    cancellation: "required",
    freshness: "required",
  },
  "assistant.research.recent-community": {
    id: "assistant.research.recent-community",
    pluginId: "assistant-recent-community-read",
    actionId: "assistant.research.recent-community",
    schemaStem: "recent-community",
    inputSchemaDigest: "sha256:f18ddfc526fea9920d77ab0a61567ca3034477eb782862b9d7765459d18ae768",
    outputSchemaDigest: "sha256:c94887d2d3da45b9db6eb682f7c49f0af10bd4a2fccd7da69fe458fead9ed083",
    hostActionClasses: ["provider-read"],
    networkClasses: ["public-community-data"],
    budgets: { inputBytes: 8_192, outputBytes: 131_072, timeoutMs: 120_000, sources: 32 },
    cancellation: "required",
    freshness: "required",
  },
  "assistant.research.taiwan-public-discussion": {
    id: "assistant.research.taiwan-public-discussion",
    pluginId: "assistant-taiwan-discussion-read",
    actionId: "assistant.research.taiwan-public-discussion",
    schemaStem: "taiwan-public-discussion",
    inputSchemaDigest: "sha256:3b270bcc2d6ddc2a704715cdaadac0314219b56cbcaeeb047eea2ff4118acbc2",
    outputSchemaDigest: "sha256:55ee41a7bc742620cdbce59253dc07ef9a349526bd13c5bd663997d022ae35b4",
    hostActionClasses: ["provider-read"],
    networkClasses: ["public-taiwan-discussion"],
    budgets: { inputBytes: 8_192, outputBytes: 131_072, timeoutMs: 120_000, sources: 32 },
    cancellation: "required",
    freshness: "required",
  },
};

function fail(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  return value as Fields;
}

function exactKeys(value: Fields, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function boundedString(value: unknown, label: string, characters: number, nonempty = true): asserts value is string {
  if (typeof value !== "string" || (nonempty && value.length === 0) || [...value].length > characters) {
    fail(`${label} is invalid or too long`);
  }
}

function finiteNumber(value: unknown, label: string, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) {
    fail(`${label} must be a finite number in range`);
  }
}

function integer(value: unknown, label: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer in range`);
  }
}

function digest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function opaqueRef(value: unknown, label: string): asserts value is string {
  boundedString(value, label, 256);
  if (!IDENTIFIER.test(value)) fail(`${label} must be an opaque public identifier`);
}

function validCalendarComponents(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function dateTime(value: unknown, label: string): asserts value is string {
  const match = typeof value === "string" ? DATE_TIME.exec(value) : null;
  if (match === null || !validCalendarComponents(match) || !Number.isFinite(Date.parse(value as string))) {
    fail(`${label} must be an RFC 3339 timestamp`);
  }
}

function calendarDate(value: unknown, label: string): asserts value is string {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  if (match === null || !validCalendarComponents(match)) {
    fail(`${label} must be a calendar date`);
  }
}

function publicUrl(value: unknown, label: string): asserts value is string {
  boundedString(value, label, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== "" || parsed.password !== "") {
    fail(`${label} must be a credential-free HTTP(S) URL`);
  }
}

function publicTargetUrl(value: unknown, label: string): asserts value is string {
  publicUrl(value, label);
  const rawAuthority = /^(?:https?):\/\/([^/?#]*)/iu.exec(value)?.[1];
  if (rawAuthority === undefined || rawAuthority.includes("%")) {
    fail(`${label} URL authority must not use percent encoding`);
  }
  const parsed = new URL(value);
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) !== 0) {
    fail(`${label} must name a DNS host whose resolved target is public`);
  }
}

function freezeClone<T>(value: T): T {
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

function jsonBytes(value: unknown, label: string, maximum: number): number {
  const ancestors = new Set<object>();
  let items = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 24) fail(`${label} exceeds its depth limit`);
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) fail(`${label} must be lossless JSON`);
      return;
    }
    if (candidate === null || typeof candidate !== "object") fail(`${label} must be lossless JSON`);
    if (ancestors.has(candidate)) fail(`${label} must not contain cycles`);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!isArray && prototype !== Object.prototype && prototype !== null) || (isArray && prototype !== Array.prototype)) {
      fail(`${label} must contain only JSON containers`);
    }
    ancestors.add(candidate);
    const ownEnumerableKeys: string[] = [];
    for (const key in candidate) {
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue;
      items += 1;
      if (items > 2_048) fail(`${label} exceeds its item limit`);
      ownEnumerableKeys.push(key);
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor === undefined) fail(`${label} changed during validation`);
      if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
        fail(`${label} must contain only enumerable data fields`);
      }
      visit(descriptor.value, depth + 1);
    }
    if (Object.getOwnPropertySymbols(candidate).length !== 0) fail(`${label} must not contain symbols`);
    const ownNames = Object.getOwnPropertyNames(candidate);
    if (ownNames.length !== ownEnumerableKeys.length + (isArray ? 1 : 0)) {
      fail(`${label} must contain only enumerable data fields`);
    }
    if (isArray) {
      if (ownEnumerableKeys.length !== (candidate as unknown[]).length) fail(`${label} arrays must be dense`);
      ownEnumerableKeys.forEach((key, index) => { if (key !== String(index)) fail(`${label} arrays must be dense`); });
    }
    ancestors.delete(candidate);
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maximum) fail(`${label} exceeds its byte limit`);
  return bytes;
}

function capability(value: unknown): AssistantReadCapabilityId {
  if (typeof value !== "string" || !ASSISTANT_READ_CAPABILITY_IDS.includes(value as AssistantReadCapabilityId)) {
    fail("capability is not a supported assistant read contract");
  }
  return value as AssistantReadCapabilityId;
}

function boundedUniqueStrings(
  value: unknown,
  label: string,
  allowed: readonly string[],
  maximum: number,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail(`${label} must be a bounded array`);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (typeof item !== "string" || !allowed.includes(item)) fail(`${label}[${index}] is unsupported`);
    if (seen.has(item)) fail(`${label} must be unique`);
    seen.add(item);
  });
}

function validateWeatherInput(value: unknown): void {
  const input = record(value, "weather input");
  exactKeys(input, ["location", "units", "days"], [], "weather input");
  boundedString(input.location, "weather input.location", 256);
  if (!['metric', 'imperial'].includes(input.units as string)) fail("weather input.units is unsupported");
  integer(input.days, "weather input.days", 1, 10);
}

function validateMarketInput(value: unknown): void {
  const input = record(value, "market input");
  if (input.kind === "quote") {
    exactKeys(input, ["kind", "symbols"], [], "market input");
    if (!Array.isArray(input.symbols) || input.symbols.length < 1 || input.symbols.length > 20) fail("market input.symbols must be bounded");
    const seen = new Set<string>();
    input.symbols.forEach((symbol, index) => {
      boundedString(symbol, `market input.symbols[${index}]`, 64);
      if (seen.has(symbol)) fail("market input.symbols must be unique");
      seen.add(symbol);
    });
    return;
  }
  if (input.kind === "exchange-rate") {
    exactKeys(input, ["kind", "base", "quotes"], [], "market input");
    if (typeof input.base !== "string" || !CURRENCY.test(input.base)) fail("market input.base must be an ISO currency code");
    if (!Array.isArray(input.quotes) || input.quotes.length < 1 || input.quotes.length > 10) fail("market input.quotes must be bounded");
    const seen = new Set<string>();
    input.quotes.forEach((quote, index) => {
      if (typeof quote !== "string" || !CURRENCY.test(quote)) fail(`market input.quotes[${index}] must be an ISO currency code`);
      if (quote === input.base || seen.has(quote)) fail("market input.quotes must be distinct from base and unique");
      seen.add(quote);
    });
    return;
  }
  fail("market input.kind is unsupported");
}

function validateSteamInput(value: unknown): void {
  const input = record(value, "Steam input");
  exactKeys(input, ["query", "countryCode", "currency", "limit"], [], "Steam input");
  boundedString(input.query, "Steam input.query", 512);
  if (typeof input.countryCode !== "string" || !COUNTRY.test(input.countryCode)) fail("Steam input.countryCode is invalid");
  if (typeof input.currency !== "string" || !CURRENCY.test(input.currency)) fail("Steam input.currency is invalid");
  integer(input.limit, "Steam input.limit", 1, 20);
}

function validateWebInput(value: unknown): void {
  const input = record(value, "web input");
  if (input.operation === "search") {
    exactKeys(input, ["operation", "query", "limit"], [], "web input");
    boundedString(input.query, "web input.query", 2_048);
    integer(input.limit, "web input.limit", 1, 20);
    return;
  }
  if (input.operation === "extract") {
    exactKeys(input, ["operation", "url", "maxChars"], [], "web input");
    publicTargetUrl(input.url, "web input.url");
    integer(input.maxChars, "web input.maxChars", 1, 65_536);
    return;
  }
  fail("web input.operation is unsupported");
}

function validateResearchInput(value: unknown, taiwan: boolean): void {
  const label = taiwan ? "Taiwan research input" : "recent community input";
  const required = taiwan
    ? ["topic", "since", "until", "locale", "sourceClasses", "maxFindings"]
    : ["topic", "since", "until", "sourceClasses", "maxFindings"];
  const input = record(value, label);
  exactKeys(input, required, [], label);
  boundedString(input.topic, `${label}.topic`, 2_048);
  dateTime(input.since, `${label}.since`);
  dateTime(input.until, `${label}.until`);
  const since = Date.parse(input.since);
  const until = Date.parse(input.until);
  if (since >= until || until - since > 31 * 24 * 60 * 60 * 1_000) fail(`${label} window must be positive and at most 31 days`);
  if (taiwan && input.locale !== "zh-TW") fail(`${label}.locale must be zh-TW`);
  boundedUniqueStrings(
    input.sourceClasses,
    `${label}.sourceClasses`,
    taiwan ? ["forum", "news", "social"] : ["community", "news", "social"],
    3,
  );
  integer(input.maxFindings, `${label}.maxFindings`, 1, 32);
}

const inputValidators: Record<AssistantReadCapabilityId, (value: unknown) => void> = {
  "assistant.weather.lookup": validateWeatherInput,
  "assistant.market.lookup": validateMarketInput,
  "assistant.steam.catalog.lookup": validateSteamInput,
  "assistant.web.lookup": validateWebInput,
  "assistant.research.recent-community": value => validateResearchInput(value, false),
  "assistant.research.taiwan-public-discussion": value => validateResearchInput(value, true),
};

function validateAdmission(value: unknown): Readonly<AssistantReadAdmission> {
  jsonBytes(value, "assistant read admission", 16_384);
  const admission = record(value, "assistant read admission");
  exactKeys(admission, [
    "admissionId", "capabilityId", "implementationDigest", "bindingDigest", "audienceRefs", "limits",
  ], [], "assistant read admission");
  opaqueRef(admission.admissionId, "assistant read admission.admissionId");
  const capabilityId = capability(admission.capabilityId);
  digest(admission.implementationDigest, "assistant read admission.implementationDigest");
  digest(admission.bindingDigest, "assistant read admission.bindingDigest");
  if (!Array.isArray(admission.audienceRefs) || admission.audienceRefs.length < 1 || admission.audienceRefs.length > 64) {
    fail("assistant read admission.audienceRefs must be bounded");
  }
  let previous = "";
  admission.audienceRefs.forEach((audience, index) => {
    opaqueRef(audience, `assistant read admission.audienceRefs[${index}]`);
    if (index > 0 && audience <= previous) fail("assistant read admission.audienceRefs must be sorted and unique");
    previous = audience;
  });
  const limits = record(admission.limits, "assistant read admission.limits");
  exactKeys(limits, ["inputBytes", "outputBytes", "timeoutMs", "sources"], [], "assistant read admission.limits");
  const ceiling = contracts[capabilityId].budgets;
  for (const field of ["inputBytes", "outputBytes", "timeoutMs", "sources"] as const) {
    integer(limits[field], `assistant read admission.limits.${field}`, 1, ceiling[field]);
  }
  return freezeClone(admission) as unknown as Readonly<AssistantReadAdmission>;
}

export function authorizeAssistantReadInvocation(
  admission: AssistantReadAdmission,
  invocation: AssistantReadInvocation,
): Readonly<AuthorizedAssistantReadInvocation>;
export function authorizeAssistantReadInvocation(admissionValue: unknown, invocationValue: unknown): unknown {
  const admission = validateAdmission(admissionValue);
  jsonBytes(invocationValue, "assistant read invocation", 16_384);
  const invocation = record(invocationValue, "assistant read invocation");
  exactKeys(invocation, [
    "capabilityId", "requestId", "implementationDigest", "audienceRef", "input", "control",
  ], [], "assistant read invocation");
  const capabilityId = capability(invocation.capabilityId);
  if (capabilityId !== admission.capabilityId) fail("capability is not admitted for this invocation");
  opaqueRef(invocation.requestId, "assistant read invocation.requestId");
  digest(invocation.implementationDigest, "assistant read invocation.implementationDigest");
  if (invocation.implementationDigest !== admission.implementationDigest) fail("implementation identity is not admitted");
  opaqueRef(invocation.audienceRef, "assistant read invocation.audienceRef");
  if (!admission.audienceRefs.includes(invocation.audienceRef)) fail("audience is not admitted");
  const control = record(invocation.control, "assistant read invocation.control");
  exactKeys(control, ["timeoutMs", "maxOutputBytes", "maxSources", "cancellationRef"], [], "assistant read invocation.control");
  integer(control.timeoutMs, "assistant read invocation.control.timeoutMs", 1, admission.limits.timeoutMs);
  integer(control.maxOutputBytes, "assistant read invocation.control.maxOutputBytes", 1, admission.limits.outputBytes);
  integer(control.maxSources, "assistant read invocation.control.maxSources", 1, admission.limits.sources);
  opaqueRef(control.cancellationRef, "assistant read invocation.control.cancellationRef");
  jsonBytes(invocation.input, "assistant read input", admission.limits.inputBytes);
  inputValidators[capabilityId](invocation.input);
  return freezeClone({
    capabilityId,
    requestId: invocation.requestId,
    admissionId: admission.admissionId,
    implementationDigest: admission.implementationDigest,
    bindingDigest: admission.bindingDigest,
    audienceRef: invocation.audienceRef,
    input: invocation.input,
    control,
  });
}

function validateAuthorizedInvocation(value: unknown): Readonly<AuthorizedAssistantReadInvocation> {
  jsonBytes(value, "authorized assistant read invocation", 32_768);
  const authorized = record(value, "authorized assistant read invocation");
  exactKeys(authorized, [
    "capabilityId", "requestId", "admissionId", "implementationDigest",
    "bindingDigest", "audienceRef", "input", "control",
  ], [], "authorized assistant read invocation");
  const capabilityId = capability(authorized.capabilityId);
  opaqueRef(authorized.requestId, "authorized assistant read invocation.requestId");
  opaqueRef(authorized.admissionId, "authorized assistant read invocation.admissionId");
  digest(authorized.implementationDigest, "authorized assistant read invocation.implementationDigest");
  digest(authorized.bindingDigest, "authorized assistant read invocation.bindingDigest");
  opaqueRef(authorized.audienceRef, "authorized assistant read invocation.audienceRef");
  const control = record(authorized.control, "authorized assistant read invocation.control");
  exactKeys(control, ["timeoutMs", "maxOutputBytes", "maxSources", "cancellationRef"], [], "authorized assistant read invocation.control");
  const ceiling = contracts[capabilityId].budgets;
  integer(control.timeoutMs, "authorized assistant read invocation.control.timeoutMs", 1, ceiling.timeoutMs);
  integer(control.maxOutputBytes, "authorized assistant read invocation.control.maxOutputBytes", 1, ceiling.outputBytes);
  integer(control.maxSources, "authorized assistant read invocation.control.maxSources", 1, ceiling.sources);
  opaqueRef(control.cancellationRef, "authorized assistant read invocation.control.cancellationRef");
  jsonBytes(authorized.input, "authorized assistant read invocation.input", ceiling.inputBytes);
  inputValidators[capabilityId](authorized.input);
  return freezeClone(authorized) as unknown as Readonly<AuthorizedAssistantReadInvocation>;
}

function validateSource(value: unknown, label: string, asOfMs: number): void {
  const source = record(value, label);
  exactKeys(source, ["url", "title", "retrievedAt", "contentDigest"], ["publishedAt"], label);
  publicUrl(source.url, `${label}.url`);
  boundedString(source.title, `${label}.title`, 1_024, false);
  dateTime(source.retrievedAt, `${label}.retrievedAt`);
  if (source.publishedAt !== undefined) dateTime(source.publishedAt, `${label}.publishedAt`);
  digest(source.contentDigest, `${label}.contentDigest`);
  const retrievedAtMs = Date.parse(source.retrievedAt);
  if (retrievedAtMs > asOfMs) fail(`${label}.retrievedAt must not be after result.asOf`);
  if (source.publishedAt !== undefined && Date.parse(source.publishedAt) > retrievedAtMs) {
    fail(`${label}.publishedAt must not be after retrievedAt`);
  }
}

function validateSourceIndexes(value: unknown, label: string, sourceCount: number): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) fail(`${label} must be a bounded array`);
  const seen = new Set<number>();
  value.forEach((index, position) => {
    integer(index, `${label}[${position}]`, 0, Math.max(0, sourceCount - 1));
    if (seen.has(index)) fail(`${label} must be unique`);
    seen.add(index);
  });
}

function validateWindow(value: unknown, label: string): void {
  const window = record(value, label);
  exactKeys(window, ["since", "until"], [], label);
  dateTime(window.since, `${label}.since`);
  dateTime(window.until, `${label}.until`);
  if (Date.parse(window.since) >= Date.parse(window.until)) fail(`${label} must be positive`);
}

function validateFinding(value: unknown, label: string, sourceCount: number): void {
  const finding = record(value, label);
  exactKeys(finding, ["claim", "sourceIndexes", "confidence"], [], label);
  boundedString(finding.claim, `${label}.claim`, 8_192);
  validateSourceIndexes(finding.sourceIndexes, `${label}.sourceIndexes`, sourceCount);
  if (!['low', 'medium', 'high'].includes(finding.confidence as string)) fail(`${label}.confidence is unsupported`);
}

function validateWeatherData(value: unknown, inputValue: JsonValue): void {
  const input = record(inputValue, "authorized weather input");
  const data = record(value, "weather result.data");
  exactKeys(data, ["location", "units", "current", "daily"], [], "weather result.data");
  boundedString(data.location, "weather result.data.location", 256);
  if (data.location !== input.location) fail("weather result.data.location does not match the authorized request");
  if (!['metric', 'imperial'].includes(data.units as string)) fail("weather result.data.units is unsupported");
  if (data.units !== input.units) fail("weather result.data.units does not match the authorized request");
  const current = record(data.current, "weather result.data.current");
  exactKeys(current, ["temperature", "condition"], [], "weather result.data.current");
  finiteNumber(current.temperature, "weather result.data.current.temperature", -150, 150);
  boundedString(current.condition, "weather result.data.current.condition", 128, false);
  if (!Array.isArray(data.daily) || data.daily.length > (input.days as number)) {
    fail("weather result.data.daily exceeds the authorized day count");
  }
  data.daily.forEach((candidate, index) => {
    const day = record(candidate, `weather result.data.daily[${index}]`);
    exactKeys(day, ["date", "low", "high", "condition"], [], `weather result.data.daily[${index}]`);
    calendarDate(day.date, `weather result.data.daily[${index}].date`);
    finiteNumber(day.low, `weather result.data.daily[${index}].low`, -150, 150);
    finiteNumber(day.high, `weather result.data.daily[${index}].high`, -150, 150);
    if (day.low > day.high) fail(`weather result.data.daily[${index}] has an inverted range`);
    boundedString(day.condition, `weather result.data.daily[${index}].condition`, 128, false);
  });
}

function validateMarketData(value: unknown, inputValue: JsonValue, asOfMs: number): void {
  const input = record(inputValue, "authorized market input");
  const data = record(value, "market result.data");
  exactKeys(data, ["quotes", "exchangeRates"], [], "market result.data");
  const quoteRequest = input.kind === "quote";
  const requestedSymbols = quoteRequest ? input.symbols as string[] : [];
  const requestedQuotes = quoteRequest ? [] : input.quotes as string[];
  if (!Array.isArray(data.quotes) || data.quotes.length > requestedSymbols.length) {
    fail("market result.data.quotes exceeds the authorized symbols");
  }
  const seenSymbols = new Set<string>();
  data.quotes.forEach((candidate, index) => {
    const quote = record(candidate, `market result.data.quotes[${index}]`);
    exactKeys(quote, ["symbol", "currency", "price", "observedAt"], [], `market result.data.quotes[${index}]`);
    boundedString(quote.symbol, `market result.data.quotes[${index}].symbol`, 64);
    if (typeof quote.currency !== "string" || !CURRENCY.test(quote.currency)) fail("market quote currency is invalid");
    finiteNumber(quote.price, `market result.data.quotes[${index}].price`, 0);
    dateTime(quote.observedAt, `market result.data.quotes[${index}].observedAt`);
    if (!quoteRequest || !requestedSymbols.includes(quote.symbol as string) || seenSymbols.has(quote.symbol as string)) {
      fail("market quote is not bound to one authorized symbol");
    }
    if (Date.parse(quote.observedAt) > asOfMs) fail("market quote observedAt must not be after result.asOf");
    seenSymbols.add(quote.symbol as string);
  });
  if (!Array.isArray(data.exchangeRates) || data.exchangeRates.length > requestedQuotes.length) {
    fail("market result.data.exchangeRates exceeds the authorized currencies");
  }
  const seenQuotes = new Set<string>();
  data.exchangeRates.forEach((candidate, index) => {
    const rate = record(candidate, `market result.data.exchangeRates[${index}]`);
    exactKeys(rate, ["base", "quote", "rate", "observedAt"], [], `market result.data.exchangeRates[${index}]`);
    if (typeof rate.base !== "string" || !CURRENCY.test(rate.base) || typeof rate.quote !== "string" || !CURRENCY.test(rate.quote)) {
      fail("market exchange currencies are invalid");
    }
    finiteNumber(rate.rate, `market result.data.exchangeRates[${index}].rate`, Number.MIN_VALUE);
    dateTime(rate.observedAt, `market result.data.exchangeRates[${index}].observedAt`);
    if (quoteRequest || rate.base !== input.base || !requestedQuotes.includes(rate.quote as string) || seenQuotes.has(rate.quote as string)) {
      fail("market exchange rate is not bound to one authorized currency pair");
    }
    if (Date.parse(rate.observedAt) > asOfMs) fail("market exchange rate observedAt must not be after result.asOf");
    seenQuotes.add(rate.quote as string);
  });
}

function validateSteamData(value: unknown, inputValue: JsonValue, asOfMs: number): void {
  const input = record(inputValue, "authorized Steam input");
  const data = record(value, "Steam result.data");
  exactKeys(data, ["games"], [], "Steam result.data");
  if (!Array.isArray(data.games) || data.games.length > (input.limit as number)) {
    fail("Steam result.data.games exceeds the authorized result limit");
  }
  data.games.forEach((candidate, index) => {
    const game = record(candidate, `Steam result.data.games[${index}]`);
    exactKeys(game, [
      "appId", "name", "currency", "finalPrice", "originalPrice", "discountPercent", "observedAt", "storeUrl",
    ], [], `Steam result.data.games[${index}]`);
    integer(game.appId, `Steam result.data.games[${index}].appId`, 1, 2_147_483_647);
    boundedString(game.name, `Steam result.data.games[${index}].name`, 512);
    if (typeof game.currency !== "string" || !CURRENCY.test(game.currency)) fail("Steam game currency is invalid");
    if (game.currency !== input.currency) fail("Steam game currency does not match the authorized request");
    integer(game.finalPrice, `Steam result.data.games[${index}].finalPrice`, 0, 2_147_483_647);
    integer(game.originalPrice, `Steam result.data.games[${index}].originalPrice`, 0, 2_147_483_647);
    integer(game.discountPercent, `Steam result.data.games[${index}].discountPercent`, 0, 100);
    if (game.finalPrice > game.originalPrice) fail("Steam game final price exceeds original price");
    dateTime(game.observedAt, `Steam result.data.games[${index}].observedAt`);
    if (Date.parse(game.observedAt) > asOfMs) fail("Steam game observedAt must not be after result.asOf");
    publicUrl(game.storeUrl, `Steam result.data.games[${index}].storeUrl`);
  });
}

function validateWebData(value: unknown, inputValue: JsonValue): void {
  const input = record(inputValue, "authorized web input");
  const data = record(value, "web result.data");
  exactKeys(data, ["results", "extraction"], [], "web result.data");
  const search = input.operation === "search";
  const searchLimit = search ? input.limit as number : 0;
  if (!Array.isArray(data.results) || data.results.length > searchLimit) {
    fail("web result.data.results exceeds the authorized search limit");
  }
  data.results.forEach((candidate, index) => {
    const item = record(candidate, `web result.data.results[${index}]`);
    exactKeys(item, ["url", "title", "excerpt"], [], `web result.data.results[${index}]`);
    publicUrl(item.url, `web result.data.results[${index}].url`);
    boundedString(item.title, `web result.data.results[${index}].title`, 1_024, false);
    boundedString(item.excerpt, `web result.data.results[${index}].excerpt`, 4_096, false);
  });
  if (search && data.extraction !== null) fail("web search result cannot carry an extraction");
  if (!search && data.extraction === null) fail("web extract result requires an extraction");
  if (data.extraction !== null) {
    const extraction = record(data.extraction, "web result.data.extraction");
    exactKeys(extraction, ["url", "title", "text", "contentDigest"], [], "web result.data.extraction");
    publicUrl(extraction.url, "web result.data.extraction.url");
    if (new URL(extraction.url as string).href !== new URL(input.url as string).href) {
      fail("web extraction URL does not match the authorized target");
    }
    boundedString(extraction.title, "web result.data.extraction.title", 1_024, false);
    boundedString(extraction.text, "web result.data.extraction.text", 65_536, false);
    if ([...(extraction.text as string)].length > (input.maxChars as number)) {
      fail("web extraction text exceeds the authorized character limit");
    }
    digest(extraction.contentDigest, "web result.data.extraction.contentDigest");
  }
}

function validateRecentCommunityData(value: unknown, sourceCount: number, inputValue: JsonValue): void {
  const input = record(inputValue, "authorized recent community input");
  const data = record(value, "recent community result.data");
  exactKeys(data, ["window", "findings", "themes"], [], "recent community result.data");
  validateWindow(data.window, "recent community result.data.window");
  const window = record(data.window, "recent community result.data.window");
  if (window.since !== input.since || window.until !== input.until) fail("recent community window does not match the authorized request");
  if (!Array.isArray(data.findings) || data.findings.length > (input.maxFindings as number)) {
    fail("recent community findings exceed the authorized result limit");
  }
  data.findings.forEach((finding, index) => validateFinding(finding, `recent community result.data.findings[${index}]`, sourceCount));
  if (!Array.isArray(data.themes) || data.themes.length > 16) fail("recent community themes must be bounded");
  const themes = new Set<string>();
  data.themes.forEach((theme, index) => {
    boundedString(theme, `recent community result.data.themes[${index}]`, 256);
    if (themes.has(theme)) fail("recent community themes must be unique");
    themes.add(theme);
  });
}

function validateTaiwanData(value: unknown, sourceCount: number, inputValue: JsonValue): void {
  const input = record(inputValue, "authorized Taiwan research input");
  const data = record(value, "Taiwan research result.data");
  exactKeys(data, ["locale", "window", "findings", "trends"], [], "Taiwan research result.data");
  if (data.locale !== "zh-TW") fail("Taiwan research result.data.locale must be zh-TW");
  validateWindow(data.window, "Taiwan research result.data.window");
  const window = record(data.window, "Taiwan research result.data.window");
  if (window.since !== input.since || window.until !== input.until || data.locale !== input.locale) {
    fail("Taiwan research window or locale does not match the authorized request");
  }
  if (!Array.isArray(data.findings) || data.findings.length > (input.maxFindings as number)) {
    fail("Taiwan research findings exceed the authorized result limit");
  }
  data.findings.forEach((finding, index) => validateFinding(finding, `Taiwan research result.data.findings[${index}]`, sourceCount));
  if (!Array.isArray(data.trends) || data.trends.length > 16) fail("Taiwan research trends must be bounded");
  data.trends.forEach((candidate, index) => {
    const trend = record(candidate, `Taiwan research result.data.trends[${index}]`);
    exactKeys(trend, ["label", "direction", "sourceIndexes"], [], `Taiwan research result.data.trends[${index}]`);
    boundedString(trend.label, `Taiwan research result.data.trends[${index}].label`, 256);
    if (!['rising', 'falling', 'stable', 'mixed'].includes(trend.direction as string)) fail("Taiwan trend direction is unsupported");
    validateSourceIndexes(trend.sourceIndexes, `Taiwan research result.data.trends[${index}].sourceIndexes`, sourceCount);
  });
}

export function validateAssistantReadResult(
  authorization: AuthorizedAssistantReadInvocation,
  result: AssistantReadResult,
): Readonly<AssistantReadResult>;
export function validateAssistantReadResult(authorizationValue: unknown, resultValue: unknown): unknown {
  const authorization = validateAuthorizedInvocation(authorizationValue);
  const capabilityId = authorization.capabilityId;
  const contract = contracts[capabilityId];
  jsonBytes(
    resultValue,
    "assistant read output",
    Math.min(contract.budgets.outputBytes, authorization.control.maxOutputBytes),
  );
  const result = record(resultValue, "assistant read result");
  exactKeys(result, ["status", "asOf", "summary", "sources", "data"], [], "assistant read result");
  if (!['completed', 'cancelled', 'timed-out'].includes(result.status as string)) fail("assistant read result.status is unsupported");
  boundedString(result.summary, "assistant read result.summary", 8_192, false);
  if (!Array.isArray(result.sources)
    || result.sources.length > Math.min(contract.budgets.sources, authorization.control.maxSources)) {
    fail("assistant read result.sources exceeds the authorized limit");
  }
  if (result.status !== "completed") {
    if (result.asOf !== null || result.sources.length !== 0 || result.data !== null) {
      fail("terminal cancelled or timed-out result cannot carry stale data or sources");
    }
    return freezeClone(result);
  }
  dateTime(result.asOf, "assistant read result.asOf");
  const asOfMs = Date.parse(result.asOf);
  result.sources.forEach((source, index) => {
    validateSource(source, `assistant read result.sources[${index}]`, asOfMs);
  });
  if (result.sources.length < 1) fail("completed assistant read result requires source freshness metadata");
  if (result.data === null) fail("completed assistant read result.data is required");
  switch (capabilityId) {
    case "assistant.weather.lookup": validateWeatherData(result.data, authorization.input); break;
    case "assistant.market.lookup": validateMarketData(result.data, authorization.input, asOfMs); break;
    case "assistant.steam.catalog.lookup": validateSteamData(result.data, authorization.input, asOfMs); break;
    case "assistant.web.lookup": validateWebData(result.data, authorization.input); break;
    case "assistant.research.recent-community":
      validateRecentCommunityData(result.data, result.sources.length, authorization.input);
      break;
    case "assistant.research.taiwan-public-discussion":
      validateTaiwanData(result.data, result.sources.length, authorization.input);
      break;
  }
  return freezeClone(result);
}

export const ASSISTANT_READ_CONTRACTS: Readonly<Record<AssistantReadCapabilityId, AssistantReadCapabilityContract>> =
  freezeClone(contracts);

export function createAssistantReadPluginDescriptor(
  runtimeKit: DescriptorOwner,
  capabilityId: AssistantReadCapabilityId,
  artifactIdentity: ImmutableAssistantReadArtifactIdentity,
): Readonly<PluginDescriptor>;
export function createAssistantReadPluginDescriptor(runtimeKitValue: unknown, capabilityValue: unknown, artifactValue: unknown): unknown {
  const runtimeKit = runtimeKitValue as Partial<DescriptorOwner> | null | undefined;
  if (typeof runtimeKit?.computeDocumentDigest !== "function" || typeof runtimeKit.validatePluginDescriptor !== "function") {
    fail("runtime-kit plugin descriptor owner is required");
  }
  const capabilityId = capability(capabilityValue);
  const contract = contracts[capabilityId];
  jsonBytes(artifactValue, "artifact identity", 4_096);
  const artifact = record(artifactValue, "artifact identity");
  exactKeys(artifact, ["digest", "sourceRevision", "attestationIdentity"], [], "artifact identity");
  digest(artifact.digest, "artifact identity.digest");
  if (typeof artifact.sourceRevision !== "string" || !REVISION.test(artifact.sourceRevision)) {
    fail("artifact identity.sourceRevision must be immutable");
  }
  boundedString(artifact.attestationIdentity, "artifact identity.attestationIdentity", 1_024);

  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: { id: contract.pluginId, version: "0.4.0", digest: `sha256:${"0".repeat(64)}` },
    artifact: {
      package: "@sympoies/dsh-assistant-read-contracts",
      digest: artifact.digest,
      entrypoint: "packages/assistant-read-contracts/src/index.ts",
      sourceRevision: artifact.sourceRevision,
      attestationIdentity: artifact.attestationIdentity,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"],
    },
    capabilities: {
      provides: [capabilityId], requires: [], tools: [], skills: [], services: [], dependencies: [],
    },
    actions: [{
      id: contract.actionId,
      class: "read",
      inputSchemaDigest: contract.inputSchemaDigest,
      outputSchemaDigest: contract.outputSchemaDigest,
      sideEffect: "none",
      idempotency: "supported",
      capability: capabilityId,
    }],
    configuration: { schemaDigest: CONFIG_SCHEMA_DIGEST, defaults: { enabled: false } },
    mediation: {
      filesystem: [], network: [...contract.networkClasses], subprocess: [], credentialHandleClasses: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: contract.budgets.outputBytes },
    },
    health: { probes: [{ id: `${contract.pluginId}.ready`, requirement: "required" }] },
    composition: {
      conflicts: [], cardinality: { min: 0, max: 1 }, namespaceClaims: [contract.pluginId],
      ordering: { before: [], after: [] },
    },
    lifecycle: {
      readiness: "required", interrupt: "supported", drain: "required", disposal: "required", recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = runtimeKit.computeDocumentDigest(descriptor);
  return definePlugin(runtimeKit as DescriptorOwner, descriptor as unknown as PluginDescriptor);
}
