import { createHash } from "node:crypto";

export const BATCH_INVOCATION_API_VERSION = "applications.sympoies.dev/v1" as const;
export const BATCH_INVOCATION_REQUEST_SCHEMA_DIGEST = "sha256:81ca687e0625a1320d91fff029ecf7f3cd0a14716e886dc27ac96a0521af9f0e" as const;
export const BATCH_INVOCATION_RESULT_SCHEMA_DIGEST = "sha256:1b307767aea59a3795d9464e6a7de2ad5bec28cb02a43b7350150990af8eb8e3" as const;
export const BATCH_INVOCATION_TERMINALS = Object.freeze([
  "succeeded",
  "invalid-input",
  "invalid-output",
  "timed-out",
  "cancelled",
  "model-unavailable",
  "overlap-refused",
  "interrupted",
] as const);

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type BatchInvocationTerminal = typeof BATCH_INVOCATION_TERMINALS[number];
export type BatchInvocationRecovery = "fresh" | "resumed";
export type BatchInvocationRetryableTerminal = "timed-out" | "model-unavailable" | "overlap-refused" | "interrupted";
export type BatchInvocationNonRetryableTerminal = "invalid-input" | "invalid-output" | "cancelled";

export interface BatchApplicationIdentity {
  readonly id: string;
  readonly digest: string;
  readonly inputSchemaDigest: string;
  readonly outputSchemaDigest: string;
}

export interface BatchInvocationRequest {
  readonly apiVersion: typeof BATCH_INVOCATION_API_VERSION;
  readonly kind: "BatchInvocationRequest";
  readonly invocationId: string;
  readonly attempt: number;
  readonly application: BatchApplicationIdentity;
  readonly input: JsonValue;
  readonly inputDigest: string;
}

export interface BatchInvocationSucceededResult {
  readonly apiVersion: typeof BATCH_INVOCATION_API_VERSION;
  readonly kind: "BatchInvocationResult";
  readonly invocationId: string;
  readonly attempt: number;
  readonly applicationDigest: string;
  readonly applicationIdentityDigest: string;
  readonly inputDigest: string;
  readonly terminal: "succeeded";
  readonly retryable: false;
  readonly recovery: BatchInvocationRecovery;
  readonly runtimeReceiptDigest: string;
  readonly output: JsonValue;
  readonly outputDigest: string;
}

interface BatchInvocationFailedResultBase {
  readonly apiVersion: typeof BATCH_INVOCATION_API_VERSION;
  readonly kind: "BatchInvocationResult";
  readonly invocationId: string;
  readonly attempt: number;
  readonly applicationDigest: string;
  readonly applicationIdentityDigest: string;
  readonly inputDigest: string;
  readonly recovery: BatchInvocationRecovery;
  readonly runtimeReceiptDigest: string;
}

export type BatchInvocationFailedResult = BatchInvocationFailedResultBase & (
  | Readonly<{ terminal: BatchInvocationRetryableTerminal; retryable: true }>
  | Readonly<{ terminal: BatchInvocationNonRetryableTerminal; retryable: false }>
);

export type BatchInvocationResult = BatchInvocationSucceededResult | BatchInvocationFailedResult;

export interface NewBatchInvocationRequest {
  readonly invocationId: string;
  readonly attempt: number;
  readonly application: BatchApplicationIdentity;
  readonly input: JsonValue;
}

export type NewBatchInvocationResult =
  | Readonly<{
    terminal: "succeeded";
    recovery: BatchInvocationRecovery;
    runtimeReceiptDigest: string;
    output: JsonValue;
  }>
  | Readonly<{
    terminal: Exclude<BatchInvocationTerminal, "succeeded">;
    recovery: BatchInvocationRecovery;
    runtimeReceiptDigest: string;
    output?: never;
  }>;

type Fields = Record<string, unknown>;
type BatchInvoker = (requestBytes: Uint8Array) => Uint8Array | string | Promise<Uint8Array | string>;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const APPLICATION_IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const MAX_ATTEMPTS = 3;
const MAX_APPLICATION_IDENTITY_BYTES = 1_024;
const MAX_INPUT_BYTES = 262_144;
const MAX_OUTPUT_BYTES = 65_536;
const MAX_FRAME_BYTES = 393_216;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_ITEMS = 4_096;

const RETRYABLE: Readonly<Record<BatchInvocationTerminal, boolean>> = Object.freeze({
  succeeded: false,
  "invalid-input": false,
  "invalid-output": false,
  "timed-out": true,
  cancelled: false,
  "model-unavailable": true,
  "overlap-refused": true,
  interrupted: true,
});

function fail(message: string): never {
  throw new TypeError(message);
}

function dataRecord(value: unknown, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
      fail(`${label}.${key} must be an enumerable data field`);
    }
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) fail(`${label} must not contain symbol fields`);
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function exactKeys(value: Fields, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function identifier(value: unknown, label: string, pattern = IDENTIFIER): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} must be a stable public identifier`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function attempt(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_ATTEMPTS) {
    fail(`${label} must be an integer from 1 through ${MAX_ATTEMPTS}`);
  }
}

function jsonText(value: unknown, label: string, maximumBytes: number): string {
  let items = 0;
  const ancestors = new Set<object>();
  const visit = (candidate: unknown, path: string, depth: number): string => {
    if (depth > MAX_JSON_DEPTH) fail(`${label} exceeds its depth limit`);
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) fail(`${path} must be lossless JSON`);
      return JSON.stringify(candidate);
    }
    if (candidate === null || typeof candidate !== "object") fail(`${path} must be lossless JSON`);
    if (ancestors.has(candidate)) fail(`${path} must not contain cycles`);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!isArray && prototype !== Object.prototype && prototype !== null)
      || (isArray && prototype !== Array.prototype)
      || Object.getOwnPropertySymbols(candidate).length !== 0) fail(`${path} must contain only JSON data`);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if (isArray) {
      const dataKeys = keys.filter(key => key !== "length");
      if (dataKeys.length !== candidate.length) fail(`${path} arrays must be dense`);
      for (let index = 0; index < dataKeys.length; index += 1) {
        if (dataKeys[index] !== String(index)) fail(`${path} arrays must be dense`);
      }
    }
    ancestors.add(candidate);
    const parts: string[] = [];
    for (const key of isArray ? keys.filter(item => item !== "length") : keys.sort()) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined
        || descriptor.enumerable !== true) fail(`${path}.${key} must be an enumerable data field`);
      items += 1;
      if (items > MAX_JSON_ITEMS) fail(`${label} exceeds its item limit`);
      const encoded = visit(descriptor.value, `${path}.${key}`, depth + 1);
      parts.push(isArray ? encoded : `${JSON.stringify(key)}:${encoded}`);
    }
    ancestors.delete(candidate);
    return isArray ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  };
  const encoded = visit(value, label, 0);
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) fail(`${label} exceeds its byte limit`);
  return encoded;
}

function computeDigest(domain: string, value: unknown, label: string, maximumBytes: number): string {
  const encoded = jsonText(value, label, maximumBytes);
  return `sha256:${createHash("sha256").update(domain).update("\0").update(encoded).digest("hex")}`;
}

function computeApplicationIdentityDigest(application: BatchApplicationIdentity): string {
  return computeDigest(
    "sympoies/batch-invocation-application-identity/v1",
    application,
    "application identity",
    MAX_APPLICATION_IDENTITY_BYTES,
  );
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

function validateApplication(value: unknown): BatchApplicationIdentity {
  const application = dataRecord(value, "request.application");
  exactKeys(application, ["id", "digest", "inputSchemaDigest", "outputSchemaDigest"], [], "request.application");
  const id = application.id;
  const applicationDigest = application.digest;
  const inputSchemaDigest = application.inputSchemaDigest;
  const outputSchemaDigest = application.outputSchemaDigest;
  identifier(id, "request.application.id", APPLICATION_IDENTIFIER);
  digest(applicationDigest, "request.application.digest");
  digest(inputSchemaDigest, "request.application.inputSchemaDigest");
  digest(outputSchemaDigest, "request.application.outputSchemaDigest");
  return freezeClone({ id, digest: applicationDigest, inputSchemaDigest, outputSchemaDigest });
}

export function createBatchInvocationRequest(input: NewBatchInvocationRequest): BatchInvocationRequest;
export function createBatchInvocationRequest(input: unknown): BatchInvocationRequest {
  const source = dataRecord(input, "request input");
  exactKeys(source, ["invocationId", "attempt", "application", "input"], [], "request input");
  const invocationId = source.invocationId;
  const attemptNumber = source.attempt;
  identifier(invocationId, "request input.invocationId");
  attempt(attemptNumber, "request input.attempt");
  const application = validateApplication(source.application);
  const inputDigest = computeDigest("sympoies/batch-invocation-input/v1", source.input, "request.input", MAX_INPUT_BYTES);
  const payload = freezeClone(source.input as JsonValue);
  return freezeClone({
    apiVersion: BATCH_INVOCATION_API_VERSION,
    kind: "BatchInvocationRequest" as const,
    invocationId,
    attempt: attemptNumber,
    application,
    input: payload,
    inputDigest,
  });
}

export function validateBatchInvocationRequest(input: unknown): BatchInvocationRequest {
  const request = dataRecord(input, "request");
  exactKeys(request, [
    "apiVersion", "kind", "invocationId", "attempt", "application", "input", "inputDigest",
  ], [], "request");
  if (request.apiVersion !== BATCH_INVOCATION_API_VERSION) fail("request.apiVersion is unsupported");
  if (request.kind !== "BatchInvocationRequest") fail("request.kind is unsupported");
  const invocationId = request.invocationId;
  const attemptNumber = request.attempt;
  const claimedInputDigest = request.inputDigest;
  identifier(invocationId, "request.invocationId");
  attempt(attemptNumber, "request.attempt");
  digest(claimedInputDigest, "request.inputDigest");
  const application = validateApplication(request.application);
  const expectedInputDigest = computeDigest("sympoies/batch-invocation-input/v1", request.input, "request.input", MAX_INPUT_BYTES);
  const payload = freezeClone(request.input as JsonValue);
  if (claimedInputDigest !== expectedInputDigest) fail("request.inputDigest does not match request.input");
  return freezeClone({
    apiVersion: BATCH_INVOCATION_API_VERSION,
    kind: "BatchInvocationRequest" as const,
    invocationId,
    attempt: attemptNumber,
    application,
    input: payload,
    inputDigest: claimedInputDigest,
  });
}

function validateResultShape(input: unknown): BatchInvocationResult {
  const result = dataRecord(input, "result");
  const terminal = result.terminal;
  if (typeof terminal !== "string" || !(BATCH_INVOCATION_TERMINALS as readonly string[]).includes(terminal)) {
    fail("result.terminal is unsupported");
  }
  const typedTerminal = terminal as BatchInvocationTerminal;
  const succeeded = terminal === "succeeded";
  exactKeys(result, [
    "apiVersion", "kind", "invocationId", "attempt", "applicationDigest", "applicationIdentityDigest", "inputDigest",
    "terminal", "retryable", "recovery", "runtimeReceiptDigest",
    ...(succeeded ? ["output", "outputDigest"] : []),
  ], [], "result");
  if (result.apiVersion !== BATCH_INVOCATION_API_VERSION) fail("result.apiVersion is unsupported");
  if (result.kind !== "BatchInvocationResult") fail("result.kind is unsupported");
  const invocationId = result.invocationId;
  const attemptNumber = result.attempt;
  const applicationDigest = result.applicationDigest;
  const applicationIdentityDigest = result.applicationIdentityDigest;
  const inputDigest = result.inputDigest;
  const recovery = result.recovery;
  const runtimeReceiptDigest = result.runtimeReceiptDigest;
  identifier(invocationId, "result.invocationId");
  attempt(attemptNumber, "result.attempt");
  digest(applicationDigest, "result.applicationDigest");
  digest(applicationIdentityDigest, "result.applicationIdentityDigest");
  digest(inputDigest, "result.inputDigest");
  digest(runtimeReceiptDigest, "result.runtimeReceiptDigest");
  if (result.retryable !== RETRYABLE[typedTerminal]) fail("result.retryable does not match result.terminal");
  if (recovery !== "fresh" && recovery !== "resumed") fail("result.recovery is unsupported");
  if (!succeeded) {
    const failedBase: BatchInvocationFailedResultBase = {
      apiVersion: BATCH_INVOCATION_API_VERSION,
      kind: "BatchInvocationResult" as const,
      invocationId,
      attempt: attemptNumber,
      applicationDigest,
      applicationIdentityDigest,
      inputDigest,
      recovery,
      runtimeReceiptDigest,
    };
    if (RETRYABLE[typedTerminal]) {
      return freezeClone({
        ...failedBase,
        terminal: terminal as BatchInvocationRetryableTerminal,
        retryable: true as const,
      });
    }
    return freezeClone({
      ...failedBase,
      terminal: terminal as BatchInvocationNonRetryableTerminal,
      retryable: false as const,
    });
  }
  const expectedOutputDigest = computeDigest("sympoies/batch-invocation-output/v1", result.output, "result.output", MAX_OUTPUT_BYTES);
  const output = freezeClone(result.output as JsonValue);
  const outputDigest = result.outputDigest;
  digest(outputDigest, "result.outputDigest");
  if (outputDigest !== expectedOutputDigest) fail("result.outputDigest does not match result.output");
  return freezeClone({
    apiVersion: BATCH_INVOCATION_API_VERSION,
    kind: "BatchInvocationResult" as const,
    invocationId,
    attempt: attemptNumber,
    applicationDigest,
    applicationIdentityDigest,
    inputDigest,
    terminal: "succeeded" as const,
    retryable: false as const,
    recovery,
    runtimeReceiptDigest,
    output,
    outputDigest,
  });
}

export function createBatchInvocationResult(
  request: BatchInvocationRequest,
  input: NewBatchInvocationResult,
): BatchInvocationResult;
export function createBatchInvocationResult(request: unknown, input: unknown): BatchInvocationResult {
  const expected = validateBatchInvocationRequest(request);
  const source = dataRecord(input, "result input");
  exactKeys(source, ["terminal", "recovery", "runtimeReceiptDigest"], ["output"], "result input");
  const terminal = source.terminal;
  if (typeof terminal !== "string" || !(BATCH_INVOCATION_TERMINALS as readonly string[]).includes(terminal)) {
    fail("result input.terminal is unsupported");
  }
  if (source.recovery !== "fresh" && source.recovery !== "resumed") fail("result input.recovery is unsupported");
  digest(source.runtimeReceiptDigest, "result input.runtimeReceiptDigest");
  if (terminal === "succeeded" && !("output" in source)) fail("result input.output is required for success");
  if (terminal !== "succeeded" && "output" in source) fail("result input.output is forbidden for failure");
  const base = {
    apiVersion: BATCH_INVOCATION_API_VERSION,
    kind: "BatchInvocationResult" as const,
    invocationId: expected.invocationId,
    attempt: expected.attempt,
    applicationDigest: expected.application.digest,
    applicationIdentityDigest: computeApplicationIdentityDigest(expected.application),
    inputDigest: expected.inputDigest,
    terminal,
    retryable: RETRYABLE[terminal as BatchInvocationTerminal],
    recovery: source.recovery,
    runtimeReceiptDigest: source.runtimeReceiptDigest,
  };
  if (terminal !== "succeeded") return validateResultShape(base);
  const outputDigest = computeDigest("sympoies/batch-invocation-output/v1", source.output, "result.output", MAX_OUTPUT_BYTES);
  const output = freezeClone(source.output as JsonValue);
  return validateResultShape({
    ...base,
    terminal: "succeeded",
    retryable: false,
    output,
    outputDigest,
  });
}

export function validateBatchInvocationResult(
  input: unknown,
  expectedRequest: BatchInvocationRequest,
): BatchInvocationResult {
  const result = validateResultShape(input);
  const expected = validateBatchInvocationRequest(expectedRequest);
  if (result.invocationId !== expected.invocationId) fail("result.invocationId does not match request");
  if (result.attempt !== expected.attempt) fail("result.attempt does not match request");
  if (result.applicationDigest !== expected.application.digest) fail("result.applicationDigest does not match request");
  if (result.applicationIdentityDigest !== computeApplicationIdentityDigest(expected.application)) {
    fail("result.applicationIdentityDigest does not match request");
  }
  if (result.inputDigest !== expected.inputDigest) fail("result.inputDigest does not match request");
  return result;
}

function encodeCanonical(value: unknown, label: string): Uint8Array {
  return new TextEncoder().encode(`${jsonText(value, label, MAX_FRAME_BYTES)}\n`);
}

function decodeCanonical(input: Uint8Array | string, label: string): unknown {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (!(bytes instanceof Uint8Array)) fail(`${label} bytes must be UTF-8 bytes or text`);
  if (bytes.byteLength > MAX_FRAME_BYTES) fail(`${label} exceeds its byte limit`);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(`${label} must not carry a UTF-8 BOM`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} must be valid UTF-8`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} must be valid JSON`);
  }
  const canonical = encodeCanonical(value, label);
  if (canonical.byteLength !== bytes.byteLength || canonical.some((byte, index) => byte !== bytes[index])) {
    fail(`${label} must use canonical JSON bytes`);
  }
  return value;
}

export function encodeBatchInvocationRequest(input: BatchInvocationRequest): Uint8Array {
  return encodeCanonical(validateBatchInvocationRequest(input), "request");
}

export function decodeBatchInvocationRequest(input: Uint8Array | string): BatchInvocationRequest {
  return validateBatchInvocationRequest(decodeCanonical(input, "request"));
}

export function encodeBatchInvocationResult(input: BatchInvocationResult): Uint8Array {
  return encodeCanonical(validateResultShape(input), "result");
}

export function decodeBatchInvocationResult(
  input: Uint8Array | string,
  expectedRequest: BatchInvocationRequest,
): BatchInvocationResult {
  return validateBatchInvocationResult(decodeCanonical(input, "result"), expectedRequest);
}

export async function invokeBatch(
  request: BatchInvocationRequest,
  invoke: BatchInvoker,
): Promise<BatchInvocationResult> {
  if (typeof invoke !== "function") fail("batch invocation callback is required");
  const expected = validateBatchInvocationRequest(request);
  const response = await invoke(encodeBatchInvocationRequest(expected));
  if (!(response instanceof Uint8Array) && typeof response !== "string") {
    fail("batch invocation callback must return UTF-8 bytes or text");
  }
  return decodeBatchInvocationResult(response, expected);
}
