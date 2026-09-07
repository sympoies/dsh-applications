import { definePlugin, type PluginDescriptor, type RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const CALENDAR_REQUEST_SCHEMA_DIGEST = "sha256:bdfe2eeb905a94e72b8ce85626d2f1c06dac2939884a99901b0685b4a5dcf3a2";
export const CALENDAR_RECEIPT_SCHEMA_DIGEST = "sha256:7443863c643521569cd90bfbb9340605d064bb9d638bc7420a8bb45d7e2744a9";
export const GROUP_NOTES_REQUEST_SCHEMA_DIGEST = "sha256:0fc8cc114c3c276705a952aeb963ee55e42ac31ae5b309f3869bb14a23367199";
export const GROUP_NOTES_RECEIPT_SCHEMA_DIGEST = "sha256:0d904a6ada53edeb33067fb66b7f76362781634d9a3888d04ba35fe6727ae35e";
export const WORK_RECOMMENDATION_REQUEST_SCHEMA_DIGEST = "sha256:65adb36dc1102e2103b04228150f65b73fb984690d7f99319214e9acf847d969";
export const WORK_RECOMMENDATION_RECEIPT_SCHEMA_DIGEST = "sha256:f13b281d1e641fd0ca28c30f4c3378cac378eec2f2197f281001ee32d60edfc1";
export const AGENT_SESSION_REQUEST_SCHEMA_DIGEST = "sha256:b30a9b068b6287447991d31d87ec8f84ae7ced02fdcb1f633decc3dd5edef929";
export const AGENT_SESSION_RECEIPT_SCHEMA_DIGEST = "sha256:a16d1073eb3e5f96bc010022bb91f2607203d35bde9c1364db18cc41bd3ac000";
export const AGENT_MEMORY_REQUEST_SCHEMA_DIGEST = "sha256:f750f2a2e1f74ecbb796f5c4262c1974978bfa70aafd36695060f0dfba1bf4ab";
export const AGENT_MEMORY_RECEIPT_SCHEMA_DIGEST = "sha256:54adc2c50bcefd25ba17e04be6783e22326f209c0d0d9769d2b5aa8e319a6414";

export interface OpaqueActionScope {
  readonly deploymentRef: string;
  readonly audienceRef: string;
  readonly conversationRef: string;
  readonly targetRef: string;
}

export interface BoundRequestContext {
  readonly scope: OpaqueActionScope;
  readonly requestRef: string;
}

export interface ArtifactIdentity {
  readonly digest: string;
  readonly sourceRevision: string;
  readonly attestationIdentity: string;
}

export type AgentSessionState =
  | "queued" | "running" | "awaiting-approval"
  | "succeeded" | "failed" | "cancelled" | "timed-out";

export interface AgentSessionRequestContext extends BoundRequestContext {
  readonly workspaceRef: string;
  readonly sessionRef?: string;
  readonly expectedReceiptRef?: string;
  readonly currentState?: AgentSessionState;
}

export interface BoundReceiptContext extends BoundRequestContext {
  readonly action: string;
  readonly expectedPriorReceiptRef?: string | null;
}

export interface AgentSessionReceiptContext extends BoundReceiptContext {
  readonly workspaceRef: string;
  readonly sessionRef?: string;
}

type Fields = Record<string, unknown>;

interface DescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): string;
}

const REF = /^ref:[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const METADATA_KEY = /^[a-z][a-z0-9._-]{0,63}$/u;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const TERMINAL_STATES = new Set<AgentSessionState>(["succeeded", "failed", "cancelled", "timed-out"]);
const SCOPE_KEYS = ["deploymentRef", "audienceRef", "conversationRef", "targetRef"] as const;

function fail(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) fail(`${label} has unknown symbol fields`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
      fail(`${label}.${key} must be plain JSON data`);
    }
  }
  return value as Fields;
}

function exactKeys(value: Fields, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function boundedText(
  value: unknown,
  label: string,
  maximumCharacters: number,
  { allowEmpty = false }: { readonly allowEmpty?: boolean } = {},
): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || [...value].length > maximumCharacters) {
    fail(`${label} is invalid or too long`);
  }
}

function opaqueRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !REF.test(value)) fail(`${label} must be an opaque deployment-scoped ref`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function positiveInteger(value: unknown, label: string, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} is out of range`);
  }
}

function uint64(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value)
    || BigInt(value) > 18_446_744_073_709_551_615n) fail(`${label} must be a canonical uint64 string`);
}

function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be an RFC 3339 timestamp`);
  }
}

function enumeration<const T extends string>(value: unknown, allowed: readonly T[], label: string): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} is unsupported`);
}

function boundedArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be a bounded array`);
  return value;
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

function validatedScope(input: unknown, expected: OpaqueActionScope, label: string): OpaqueActionScope {
  const actual = record(input, label);
  exactKeys(actual, SCOPE_KEYS, [], label);
  const result: Record<(typeof SCOPE_KEYS)[number], string> = {} as Record<(typeof SCOPE_KEYS)[number], string>;
  for (const key of SCOPE_KEYS) {
    const value = actual[key];
    opaqueRef(value, `${label}.${key}`);
    opaqueRef(expected[key], `expectedScope.${key}`);
    if (value !== expected[key]) fail(`${label}.${key} scope binding mismatch`);
    result[key] = value;
  }
  return result;
}

function requestHead(
  input: unknown,
  expected: BoundRequestContext,
  actions: readonly string[],
  required: readonly string[],
  optional: readonly string[],
  label: string,
): { value: Fields; action: string; requestRef: string; scope: OpaqueActionScope } {
  const value = record(input, label);
  exactKeys(value, ["action", "requestRef", "scope", ...required], optional, label);
  const action = value.action;
  enumeration(action, actions, `${label}.action`);
  const requestRef = value.requestRef;
  opaqueRef(requestRef, `${label}.requestRef`);
  opaqueRef(expected.requestRef, "expected requestRef");
  if (requestRef !== expected.requestRef) fail(`${label}.requestRef does not match the admitted request`);
  return { value, action, requestRef, scope: validatedScope(value.scope, expected.scope, `${label}.scope`) };
}

function receiptHead(
  input: unknown,
  expected: BoundReceiptContext,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): { value: Fields; action: string; requestRef: string; scope: OpaqueActionScope } {
  const head = requestHead(input, expected, [expected.action], required, optional, label);
  return head;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  boundedText(value, label, maximum, { allowEmpty: true });
  return value;
}

function validateWindow(value: unknown, label: string): { startsAt: string; endsAt: string } {
  const window = record(value, label);
  exactKeys(window, ["startsAt", "endsAt"], [], label);
  const startsAt = window.startsAt;
  const endsAt = window.endsAt;
  timestamp(startsAt, `${label}.startsAt`);
  timestamp(endsAt, `${label}.endsAt`);
  if (Date.parse(startsAt) >= Date.parse(endsAt)) fail(`${label} time range is not increasing`);
  return { startsAt, endsAt };
}

function validateEventPatch(value: unknown, label: string): Fields {
  const patch = record(value, label);
  exactKeys(patch, [], ["title", "startsAt", "endsAt", "description", "location"], label);
  if (Object.keys(patch).length === 0) fail(`${label} must change at least one field`);
  if (patch.title !== undefined) boundedText(patch.title, `${label}.title`, 256);
  if (patch.startsAt !== undefined) timestamp(patch.startsAt, `${label}.startsAt`);
  if (patch.endsAt !== undefined) timestamp(patch.endsAt, `${label}.endsAt`);
  optionalText(patch.description, `${label}.description`, 2_048);
  optionalText(patch.location, `${label}.location`, 512);
  if (patch.startsAt !== undefined && patch.endsAt !== undefined
    && Date.parse(patch.startsAt as string) >= Date.parse(patch.endsAt as string)) fail(`${label} time range is not increasing`);
  return patch;
}

function validateCalendarMutation(value: unknown): Fields {
  const mutation = record(value, "calendarRequest.mutation");
  if (mutation.kind === "create") {
    exactKeys(mutation, ["kind", "title", "startsAt", "endsAt"], ["description", "location"], "calendarRequest.mutation");
    boundedText(mutation.title, "calendarRequest.mutation.title", 256);
    validateWindow({ startsAt: mutation.startsAt, endsAt: mutation.endsAt }, "calendarRequest.mutation");
    optionalText(mutation.description, "calendarRequest.mutation.description", 2_048);
    optionalText(mutation.location, "calendarRequest.mutation.location", 512);
  } else if (mutation.kind === "update") {
    exactKeys(mutation, ["kind", "eventRef", "patch"], [], "calendarRequest.mutation");
    opaqueRef(mutation.eventRef, "calendarRequest.mutation.eventRef");
    validateEventPatch(mutation.patch, "calendarRequest.mutation.patch");
  } else if (mutation.kind === "delete") {
    exactKeys(mutation, ["kind", "eventRef"], [], "calendarRequest.mutation");
    opaqueRef(mutation.eventRef, "calendarRequest.mutation.eventRef");
  } else fail("calendarRequest.mutation.kind is unsupported");
  return mutation;
}

export function validateCalendarRequest(input: unknown, expected: BoundRequestContext): Readonly<Fields> {
  const raw = record(input, "calendarRequest");
  const action = raw.action;
  if (action === "organization.calendar.read") {
    const head = requestHead(input, expected, [action], ["window", "maxItems"], [], "calendarRequest");
    const window = validateWindow(head.value.window, "calendarRequest.window");
    positiveInteger(head.value.maxItems, "calendarRequest.maxItems", 50);
    return freezeClone({ action: head.action, requestRef: head.requestRef, scope: head.scope, window, maxItems: head.value.maxItems });
  }
  if (action === "organization.calendar.write") {
    const head = requestHead(input, expected, [action], ["mutation"], [], "calendarRequest");
    const mutation = validateCalendarMutation(head.value.mutation);
    return freezeClone({ action: head.action, requestRef: head.requestRef, scope: head.scope, mutation });
  }
  fail("calendarRequest.action is unsupported");
}

function validateCalendarEvent(value: unknown, label: string): Fields {
  const event = record(value, label);
  exactKeys(event, ["eventRef", "title", "startsAt", "endsAt"], ["description", "location"], label);
  opaqueRef(event.eventRef, `${label}.eventRef`);
  boundedText(event.title, `${label}.title`, 256);
  validateWindow({ startsAt: event.startsAt, endsAt: event.endsAt }, label);
  optionalText(event.description, `${label}.description`, 2_048);
  optionalText(event.location, `${label}.location`, 512);
  return event;
}

export function validateCalendarReceipt(input: unknown, expected: BoundReceiptContext): Readonly<Fields> {
  const head = receiptHead(input, expected, ["outcome", "summary", "events"], [], "calendarReceipt");
  enumeration(head.value.outcome, ["succeeded", "denied", "cancelled", "timed-out", "failed"], "calendarReceipt.outcome");
  boundedText(head.value.summary, "calendarReceipt.summary", 4_096, { allowEmpty: true });
  boundedArray(head.value.events, "calendarReceipt.events", 16)
    .forEach((event, index) => validateCalendarEvent(event, `calendarReceipt.events[${index}]`));
  return freezeClone(head.value);
}

export function validateGroupNotesRequest(input: unknown, expected: BoundRequestContext & { readonly expectedReceiptRef?: string }): Readonly<Fields> {
  const raw = record(input, "groupNotesRequest");
  const action = raw.action;
  if (action === "conversation.group-notes.read") {
    const head = requestHead(input, expected, [action], ["limit"], [], "groupNotesRequest");
    positiveInteger(head.value.limit, "groupNotesRequest.limit", 8);
    return freezeClone({ action: head.action, requestRef: head.requestRef, scope: head.scope, limit: head.value.limit });
  }
  if (action === "conversation.group-notes.write") {
    const head = requestHead(input, expected, [action], ["mutation"], [], "groupNotesRequest");
    const mutation = record(head.value.mutation, "groupNotesRequest.mutation");
    if (mutation.kind === "upsert") {
      exactKeys(mutation, ["kind", "expectedReceiptRef", "noteRef", "title", "body"], [], "groupNotesRequest.mutation");
      boundedText(mutation.title, "groupNotesRequest.mutation.title", 256);
      boundedText(mutation.body, "groupNotesRequest.mutation.body", 4_096, { allowEmpty: true });
    } else if (mutation.kind === "delete") {
      exactKeys(mutation, ["kind", "expectedReceiptRef", "noteRef"], [], "groupNotesRequest.mutation");
    } else fail("groupNotesRequest.mutation.kind is unsupported");
    opaqueRef(mutation.noteRef, "groupNotesRequest.mutation.noteRef");
    opaqueRef(mutation.expectedReceiptRef, "groupNotesRequest.mutation.expectedReceiptRef");
    opaqueRef(expected.expectedReceiptRef, "expected receiptRef");
    if (mutation.expectedReceiptRef !== expected.expectedReceiptRef) fail("groupNotesRequest has a stale receipt binding");
    return freezeClone({ action: head.action, requestRef: head.requestRef, scope: head.scope, mutation });
  }
  fail("groupNotesRequest.action is unsupported");
}

export function validateGroupNotesReceipt(input: unknown, expected: BoundReceiptContext): Readonly<Fields> {
  const head = receiptHead(
    input, expected,
    ["outcome", "summary", "receiptRef", "priorReceiptRef", "notes"], [], "groupNotesReceipt",
  );
  enumeration(head.value.outcome, ["succeeded", "denied", "cancelled", "timed-out", "failed"], "groupNotesReceipt.outcome");
  boundedText(head.value.summary, "groupNotesReceipt.summary", 2_048, { allowEmpty: true });
  opaqueRef(head.value.receiptRef, "groupNotesReceipt.receiptRef");
  opaqueRef(head.value.priorReceiptRef, "groupNotesReceipt.priorReceiptRef");
  opaqueRef(expected.expectedPriorReceiptRef, "expected prior receiptRef");
  if (head.value.priorReceiptRef !== expected.expectedPriorReceiptRef) fail("groupNotesReceipt prior receipt replay detected");
  boundedArray(head.value.notes, "groupNotesReceipt.notes", 8).forEach((candidate, index) => {
    const note = record(candidate, `groupNotesReceipt.notes[${index}]`);
    exactKeys(note, ["noteRef", "title", "body"], [], `groupNotesReceipt.notes[${index}]`);
    opaqueRef(note.noteRef, `groupNotesReceipt.notes[${index}].noteRef`);
    boundedText(note.title, `groupNotesReceipt.notes[${index}].title`, 256);
    boundedText(note.body, `groupNotesReceipt.notes[${index}].body`, 1_024, { allowEmpty: true });
  });
  return freezeClone(head.value);
}

export function validateWorkRecommendationRequest(input: unknown, expected: BoundRequestContext): Readonly<Fields> {
  const head = requestHead(
    input, expected, ["organization.work-recommendation.read"], ["limit"], ["focus"], "workRecommendationRequest",
  );
  positiveInteger(head.value.limit, "workRecommendationRequest.limit", 8);
  optionalText(head.value.focus, "workRecommendationRequest.focus", 512);
  return freezeClone(head.value);
}

export function validateWorkRecommendationReceipt(input: unknown, expected: BoundReceiptContext): Readonly<Fields> {
  const head = receiptHead(
    input, expected, ["outcome", "summary", "recommendations"], [], "workRecommendationReceipt",
  );
  enumeration(head.value.outcome, ["succeeded", "denied", "cancelled", "timed-out", "failed"], "workRecommendationReceipt.outcome");
  boundedText(head.value.summary, "workRecommendationReceipt.summary", 2_048, { allowEmpty: true });
  boundedArray(head.value.recommendations, "workRecommendationReceipt.recommendations", 8)
    .forEach((candidate, index) => {
      const item = record(candidate, `workRecommendationReceipt.recommendations[${index}]`);
      exactKeys(item, ["itemRef", "title", "rationale", "rank"], [], `workRecommendationReceipt.recommendations[${index}]`);
      opaqueRef(item.itemRef, `workRecommendationReceipt.recommendations[${index}].itemRef`);
      boundedText(item.title, `workRecommendationReceipt.recommendations[${index}].title`, 256);
      boundedText(item.rationale, `workRecommendationReceipt.recommendations[${index}].rationale`, 1_024);
      positiveInteger(item.rank, `workRecommendationReceipt.recommendations[${index}].rank`, 8);
    });
  return freezeClone(head.value);
}

export function validateAgentMemoryRequest(
  input: unknown,
  expected: BoundRequestContext & { readonly expectedReceiptRef?: string },
): Readonly<Fields> {
  const raw = record(input, "agentMemoryRequest");
  const action = raw.action;
  if (action === "agent-memory.recall") {
    const head = requestHead(input, expected, [action], ["query", "maxItems"], [], "agentMemoryRequest");
    boundedText(head.value.query, "agentMemoryRequest.query", 1_024);
    positiveInteger(head.value.maxItems, "agentMemoryRequest.maxItems", 8);
    return freezeClone(head.value);
  }
  if (action === "agent-memory.candidate-add") {
    const head = requestHead(
      input, expected, [action], ["expectedReceiptRef", "candidate"], [], "agentMemoryRequest",
    );
    validateExpectedReceipt(head.value.expectedReceiptRef, expected.expectedReceiptRef, "agentMemoryRequest");
    const candidate = record(head.value.candidate, "agentMemoryRequest.candidate");
    exactKeys(candidate, ["summary", "evidenceRefs"], [], "agentMemoryRequest.candidate");
    boundedText(candidate.summary, "agentMemoryRequest.candidate.summary", 2_048);
    const evidenceRefs = boundedArray(candidate.evidenceRefs, "agentMemoryRequest.candidate.evidenceRefs", 8);
    const unique = new Set<string>();
    evidenceRefs.forEach((item, index) => {
      opaqueRef(item, `agentMemoryRequest.candidate.evidenceRefs[${index}]`);
      if (unique.has(item)) fail("agentMemoryRequest.candidate.evidenceRefs must be unique");
      unique.add(item);
    });
    return freezeClone(head.value);
  }
  fail("agentMemoryRequest.action is unsupported");
}

export function validateAgentMemoryReceipt(input: unknown, expected: BoundReceiptContext): Readonly<Fields> {
  const head = receiptHead(
    input, expected,
    ["outcome", "summary", "receiptRef", "priorReceiptRef", "items"], [], "agentMemoryReceipt",
  );
  enumeration(head.value.outcome, ["succeeded", "denied", "cancelled", "timed-out", "failed"], "agentMemoryReceipt.outcome");
  boundedText(head.value.summary, "agentMemoryReceipt.summary", 2_048, { allowEmpty: true });
  opaqueRef(head.value.receiptRef, "agentMemoryReceipt.receiptRef");
  opaqueRef(head.value.priorReceiptRef, "agentMemoryReceipt.priorReceiptRef");
  opaqueRef(expected.expectedPriorReceiptRef, "expected prior receiptRef");
  if (head.value.priorReceiptRef !== expected.expectedPriorReceiptRef) fail("agentMemoryReceipt prior receipt replay detected");
  boundedArray(head.value.items, "agentMemoryReceipt.items", 8).forEach((candidate, index) => {
    const item = record(candidate, `agentMemoryReceipt.items[${index}]`);
    exactKeys(item, ["memoryRef", "content", "relevance"], [], `agentMemoryReceipt.items[${index}]`);
    opaqueRef(item.memoryRef, `agentMemoryReceipt.items[${index}].memoryRef`);
    boundedText(item.content, `agentMemoryReceipt.items[${index}].content`, 1_024);
    if (typeof item.relevance !== "number" || !Number.isSafeInteger(item.relevance)
      || item.relevance < 0 || item.relevance > 100) fail(`agentMemoryReceipt.items[${index}].relevance is out of range`);
  });
  return freezeClone(head.value);
}

function validateAgentBinding(head: ReturnType<typeof requestHead>, expected: AgentSessionRequestContext): {
  workspaceRef: string;
  sessionRef?: string;
} {
  const workspaceRef = head.value.workspaceRef;
  opaqueRef(workspaceRef, "agentSessionRequest.workspaceRef");
  opaqueRef(expected.workspaceRef, "trusted workspaceRef");
  if (workspaceRef !== expected.workspaceRef) fail("agentSessionRequest workspaceRef is not deployment-approved");
  if (head.action === "agent-session.create") return { workspaceRef };
  const sessionRef = head.value.sessionRef;
  opaqueRef(sessionRef, "agentSessionRequest.sessionRef");
  opaqueRef(expected.sessionRef, "expected sessionRef");
  if (sessionRef !== expected.sessionRef) fail("agentSessionRequest sessionRef binding mismatch");
  return { workspaceRef, sessionRef };
}

function validateCurrentAgentState(action: string, expected: AgentSessionRequestContext): void {
  if (action !== "agent-session.status" && expected.currentState !== undefined && TERMINAL_STATES.has(expected.currentState)) {
    fail(`agentSessionRequest cannot ${action} a terminal session`);
  }
}

export function validateAgentSessionRequest(input: unknown, expected: AgentSessionRequestContext): Readonly<Fields> {
  const raw = record(input, "agentSessionRequest");
  const action = raw.action;
  if (action === "agent-session.create") {
    const head = requestHead(input, expected, [action], ["workspaceRef", "prompt", "timeoutSeconds"], [], "agentSessionRequest");
    validateAgentBinding(head, expected);
    boundedText(head.value.prompt, "agentSessionRequest.prompt", 4_096);
    positiveInteger(head.value.timeoutSeconds, "agentSessionRequest.timeoutSeconds", 3_600);
    return freezeClone(head.value);
  }
  if (action === "agent-session.status") {
    const head = requestHead(input, expected, [action], ["workspaceRef", "sessionRef"], [], "agentSessionRequest");
    validateAgentBinding(head, expected);
    return freezeClone(head.value);
  }
  if (action === "agent-session.attach-metadata") {
    const head = requestHead(
      input, expected, [action], ["workspaceRef", "sessionRef", "expectedReceiptRef", "metadata"], [], "agentSessionRequest",
    );
    validateAgentBinding(head, expected);
    validateCurrentAgentState(action, expected);
    validateExpectedReceipt(head.value.expectedReceiptRef, expected.expectedReceiptRef, "agentSessionRequest");
    const metadata = boundedArray(head.value.metadata, "agentSessionRequest.metadata", 8);
    if (metadata.length === 0) fail("agentSessionRequest.metadata must not be empty");
    const keys = new Set<string>();
    metadata.forEach((candidate, index) => {
      const entry = record(candidate, `agentSessionRequest.metadata[${index}]`);
      exactKeys(entry, ["key", "value"], [], `agentSessionRequest.metadata[${index}]`);
      if (typeof entry.key !== "string" || !METADATA_KEY.test(entry.key)) fail(`agentSessionRequest.metadata[${index}].key is invalid`);
      if (keys.has(entry.key)) fail("agentSessionRequest.metadata keys must be unique");
      keys.add(entry.key);
      boundedText(entry.value, `agentSessionRequest.metadata[${index}].value`, 512, { allowEmpty: true });
    });
    return freezeClone(head.value);
  }
  if (action === "agent-session.continue") {
    const head = requestHead(
      input, expected, [action], ["workspaceRef", "sessionRef", "expectedReceiptRef", "instruction", "timeoutSeconds"], [],
      "agentSessionRequest",
    );
    validateAgentBinding(head, expected);
    validateCurrentAgentState(action, expected);
    validateExpectedReceipt(head.value.expectedReceiptRef, expected.expectedReceiptRef, "agentSessionRequest");
    boundedText(head.value.instruction, "agentSessionRequest.instruction", 4_096);
    positiveInteger(head.value.timeoutSeconds, "agentSessionRequest.timeoutSeconds", 3_600);
    return freezeClone(head.value);
  }
  if (action === "agent-session.cancel") {
    const head = requestHead(
      input, expected, [action], ["workspaceRef", "sessionRef", "expectedReceiptRef", "reason"], [], "agentSessionRequest",
    );
    validateAgentBinding(head, expected);
    validateCurrentAgentState(action, expected);
    validateExpectedReceipt(head.value.expectedReceiptRef, expected.expectedReceiptRef, "agentSessionRequest");
    enumeration(head.value.reason, ["user-request", "superseded", "policy", "timeout"], "agentSessionRequest.reason");
    return freezeClone(head.value);
  }
  fail("agentSessionRequest.action is unsupported");
}

function validateExpectedReceipt(actual: unknown, expected: unknown, label: string): void {
  opaqueRef(actual, `${label}.expectedReceiptRef`);
  opaqueRef(expected, "expected receiptRef");
  if (actual !== expected) fail(`${label} has a stale receipt binding`);
}

export function validateAgentSessionReceipt(input: unknown, expected: AgentSessionReceiptContext): Readonly<Fields> {
  const head = receiptHead(input, expected, [
    "workspaceRef", "sessionRef", "receiptRef", "priorReceiptRef", "state",
    "revision", "terminal", "summary", "recovery",
  ], [], "agentSessionReceipt");
  opaqueRef(head.value.workspaceRef, "agentSessionReceipt.workspaceRef");
  opaqueRef(expected.workspaceRef, "expected workspaceRef");
  if (head.value.workspaceRef !== expected.workspaceRef) fail("agentSessionReceipt workspace binding mismatch");
  opaqueRef(head.value.sessionRef, "agentSessionReceipt.sessionRef");
  if (expected.sessionRef !== undefined) {
    opaqueRef(expected.sessionRef, "expected sessionRef");
    if (head.value.sessionRef !== expected.sessionRef) fail("agentSessionReceipt session binding mismatch");
  }
  opaqueRef(head.value.receiptRef, "agentSessionReceipt.receiptRef");
  if (head.action === "agent-session.create") {
    if (head.value.priorReceiptRef !== null || expected.expectedPriorReceiptRef !== undefined
      && expected.expectedPriorReceiptRef !== null) fail("agentSessionReceipt create cannot claim a prior receipt");
  } else {
    opaqueRef(head.value.priorReceiptRef, "agentSessionReceipt.priorReceiptRef");
    opaqueRef(expected.expectedPriorReceiptRef, "expected prior receiptRef");
    if (head.value.priorReceiptRef !== expected.expectedPriorReceiptRef) fail("agentSessionReceipt prior receipt replay detected");
  }
  enumeration(head.value.state, [
    "queued", "running", "awaiting-approval", "succeeded", "failed", "cancelled", "timed-out",
  ], "agentSessionReceipt.state");
  uint64(head.value.revision, "agentSessionReceipt.revision");
  if (typeof head.value.terminal !== "boolean"
    || head.value.terminal !== TERMINAL_STATES.has(head.value.state as AgentSessionState)) {
    fail("agentSessionReceipt terminal flag does not match state");
  }
  if (head.action === "agent-session.cancel" && (head.value.state !== "cancelled" || head.value.terminal !== true)) {
    fail("agentSessionReceipt cancel must settle as cancelled");
  }
  boundedText(head.value.summary, "agentSessionReceipt.summary", 4_096, { allowEmpty: true });
  const recovery = record(head.value.recovery, "agentSessionReceipt.recovery");
  if (recovery.kind === "none") {
    exactKeys(recovery, ["kind"], [], "agentSessionReceipt.recovery");
  } else if (recovery.kind === "resumed") {
    exactKeys(recovery, ["kind", "fromReceiptRef"], [], "agentSessionReceipt.recovery");
    opaqueRef(recovery.fromReceiptRef, "agentSessionReceipt.recovery.fromReceiptRef");
    if (head.action === "agent-session.create" || recovery.fromReceiptRef !== head.value.priorReceiptRef) {
      fail("agentSessionReceipt recovery receipt mismatch");
    }
  } else fail("agentSessionReceipt.recovery.kind is unsupported");
  return freezeClone(head.value);
}

function validateArtifactIdentity(input: unknown): ArtifactIdentity {
  const artifact = record(input, "artifactIdentity");
  exactKeys(artifact, ["digest", "sourceRevision", "attestationIdentity"], [], "artifactIdentity");
  digest(artifact.digest, "artifactIdentity.digest");
  if (typeof artifact.sourceRevision !== "string" || !SOURCE_REVISION.test(artifact.sourceRevision)) {
    fail("artifactIdentity.sourceRevision must be an immutable revision");
  }
  boundedText(artifact.attestationIdentity, "artifactIdentity.attestationIdentity", 1_024);
  return artifact as unknown as ArtifactIdentity;
}

function descriptor(
  runtimeKit: unknown,
  artifactIdentity: unknown,
  spec: {
    readonly id: string;
    readonly provides: readonly string[];
    readonly actions: readonly {
      readonly id: string;
      readonly class: "read" | "write" | "destructive" | "open-world";
      readonly inputSchemaDigest: string;
      readonly outputSchemaDigest: string;
      readonly sideEffect: "none" | "idempotent" | "non-idempotent";
      readonly idempotency: "none" | "supported" | "required";
      readonly capability: string;
    }[];
  },
): Readonly<PluginDescriptor> {
  const owner = runtimeKit as Partial<DescriptorOwner> | null | undefined;
  if (typeof owner?.computeDocumentDigest !== "function") fail("runtime-kit computeDocumentDigest owner is required");
  const artifact = validateArtifactIdentity(artifactIdentity);
  const value = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: { id: spec.id, version: "0.4.0", digest: `sha256:${"0".repeat(64)}` },
    artifact: {
      package: "@sympoies/dsh-governed-action-contracts",
      digest: artifact.digest,
      entrypoint: "packages/governed-action-contracts/src/index.ts",
      sourceRevision: artifact.sourceRevision,
      attestationIdentity: artifact.attestationIdentity,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"],
    },
    capabilities: {
      provides: [...spec.provides].sort(), requires: [], tools: [], skills: [], services: [], dependencies: [],
    },
    actions: [...spec.actions].sort((left, right) => left.id.localeCompare(right.id)),
    configuration: { schemaDigest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", defaults: {} },
    mediation: {
      filesystem: [], network: [], subprocess: [], credentialHandleClasses: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
    },
    health: { probes: [{ id: `${spec.id}.ready`, requirement: "required" }] },
    composition: {
      conflicts: [], cardinality: { min: 1, max: 1 }, namespaceClaims: [...spec.provides].sort(),
      ordering: { before: [], after: [] },
    },
    lifecycle: {
      readiness: "required", interrupt: "supported", drain: "required", disposal: "required", recovery: "reconcile",
    },
  };
  value.metadata.digest = owner.computeDocumentDigest(value);
  return definePlugin(owner as DescriptorOwner, value as unknown as PluginDescriptor);
}

export function createCalendarPluginDescriptor(runtimeKit: unknown, artifactIdentity: ArtifactIdentity): Readonly<PluginDescriptor>;
export function createCalendarPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return descriptor(runtimeKit, artifactIdentity, {
    id: "organization-calendar",
    provides: ["organization.calendar.read", "organization.calendar.write"],
    actions: [
      {
        id: "organization.calendar.read", class: "read", inputSchemaDigest: CALENDAR_REQUEST_SCHEMA_DIGEST,
        outputSchemaDigest: CALENDAR_RECEIPT_SCHEMA_DIGEST, sideEffect: "none", idempotency: "supported",
        capability: "organization.calendar.read",
      },
      {
        id: "organization.calendar.write", class: "write", inputSchemaDigest: CALENDAR_REQUEST_SCHEMA_DIGEST,
        outputSchemaDigest: CALENDAR_RECEIPT_SCHEMA_DIGEST, sideEffect: "non-idempotent", idempotency: "required",
        capability: "organization.calendar.write",
      },
    ],
  });
}

export function createGroupNotesPluginDescriptor(runtimeKit: unknown, artifactIdentity: ArtifactIdentity): Readonly<PluginDescriptor>;
export function createGroupNotesPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return descriptor(runtimeKit, artifactIdentity, {
    id: "conversation-group-notes",
    provides: ["conversation.group-notes.read", "conversation.group-notes.write"],
    actions: [
      {
        id: "conversation.group-notes.read", class: "read", inputSchemaDigest: GROUP_NOTES_REQUEST_SCHEMA_DIGEST,
        outputSchemaDigest: GROUP_NOTES_RECEIPT_SCHEMA_DIGEST, sideEffect: "none", idempotency: "supported",
        capability: "conversation.group-notes.read",
      },
      {
        id: "conversation.group-notes.write", class: "write", inputSchemaDigest: GROUP_NOTES_REQUEST_SCHEMA_DIGEST,
        outputSchemaDigest: GROUP_NOTES_RECEIPT_SCHEMA_DIGEST, sideEffect: "idempotent", idempotency: "required",
        capability: "conversation.group-notes.write",
      },
    ],
  });
}

export function createWorkRecommendationPluginDescriptor(runtimeKit: unknown, artifactIdentity: ArtifactIdentity): Readonly<PluginDescriptor>;
export function createWorkRecommendationPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return descriptor(runtimeKit, artifactIdentity, {
    id: "organization-work-recommendation",
    provides: ["organization.work-recommendation.read"],
    actions: [{
      id: "organization.work-recommendation.read", class: "read",
      inputSchemaDigest: WORK_RECOMMENDATION_REQUEST_SCHEMA_DIGEST,
      outputSchemaDigest: WORK_RECOMMENDATION_RECEIPT_SCHEMA_DIGEST,
      sideEffect: "none", idempotency: "supported", capability: "organization.work-recommendation.read",
    }],
  });
}

export function createAgentSessionPluginDescriptor(runtimeKit: unknown, artifactIdentity: ArtifactIdentity): Readonly<PluginDescriptor>;
export function createAgentSessionPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  const action = (
    id: string,
    actionClass: "read" | "write" | "destructive",
    sideEffect: "none" | "idempotent" | "non-idempotent",
    idempotency: "supported" | "required",
  ) => ({
    id, class: actionClass, inputSchemaDigest: AGENT_SESSION_REQUEST_SCHEMA_DIGEST,
    outputSchemaDigest: AGENT_SESSION_RECEIPT_SCHEMA_DIGEST, sideEffect, idempotency, capability: id,
  });
  return descriptor(runtimeKit, artifactIdentity, {
    id: "governed-agent-session",
    provides: [
      "agent-session.attach-metadata", "agent-session.cancel", "agent-session.continue",
      "agent-session.create", "agent-session.status",
    ],
    actions: [
      action("agent-session.create", "write", "non-idempotent", "required"),
      action("agent-session.status", "read", "none", "supported"),
      action("agent-session.attach-metadata", "write", "idempotent", "required"),
      action("agent-session.continue", "write", "non-idempotent", "required"),
      action("agent-session.cancel", "destructive", "idempotent", "required"),
    ],
  });
}

export function createAgentMemoryPluginDescriptor(runtimeKit: unknown, artifactIdentity: ArtifactIdentity): Readonly<PluginDescriptor>;
export function createAgentMemoryPluginDescriptor(runtimeKit: unknown, artifactIdentity: unknown): Readonly<PluginDescriptor> {
  return descriptor(runtimeKit, artifactIdentity, {
    id: "external-agent-memory",
    provides: ["agent-memory.candidate-add", "agent-memory.recall"],
    actions: [
      {
        id: "agent-memory.recall", class: "read", inputSchemaDigest: AGENT_MEMORY_REQUEST_SCHEMA_DIGEST,
        outputSchemaDigest: AGENT_MEMORY_RECEIPT_SCHEMA_DIGEST, sideEffect: "none", idempotency: "supported",
        capability: "agent-memory.recall",
      },
      {
        id: "agent-memory.candidate-add", class: "write", inputSchemaDigest: AGENT_MEMORY_REQUEST_SCHEMA_DIGEST,
        outputSchemaDigest: AGENT_MEMORY_RECEIPT_SCHEMA_DIGEST, sideEffect: "idempotent", idempotency: "required",
        capability: "agent-memory.candidate-add",
      },
    ],
  });
}
