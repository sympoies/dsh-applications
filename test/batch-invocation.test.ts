import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  BATCH_INVOCATION_TERMINALS,
  BATCH_INVOCATION_REQUEST_SCHEMA_DIGEST,
  BATCH_INVOCATION_RESULT_SCHEMA_DIGEST,
  createBatchInvocationRequest,
  createBatchInvocationResult,
  decodeBatchInvocationRequest,
  decodeBatchInvocationResult,
  encodeBatchInvocationRequest,
  encodeBatchInvocationResult,
  invokeBatch,
  type BatchInvocationTerminal,
  validateBatchInvocationRequest,
  validateBatchInvocationResult,
} from "@sympoies/dsh-batch-invocation";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const requestInput = {
  invocationId: "notification-editor-20260913t120000z",
  attempt: 1,
  application: {
    id: "system-notification-editor",
    digest: digest("a"),
    inputSchemaDigest: digest("b"),
    outputSchemaDigest: digest("c"),
  },
  input: {
    facts: [{ label: "state", value: "healthy" }],
    fallbackText: "Service is healthy.",
  },
};

test("the exported schema identities bind the shipped public schemas", async () => {
  const { createHash } = await import("node:crypto");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const requestSchema = JSON.parse(readFileSync(
    new URL("../packages/batch-invocation/schemas/invocation-request.schema.json", import.meta.url),
    "utf8",
  ));
  const resultSchema = JSON.parse(readFileSync(
    new URL("../packages/batch-invocation/schemas/invocation-result.schema.json", import.meta.url),
    "utf8",
  ));
  assert.doesNotThrow(() => ajv.compile(requestSchema));
  assert.doesNotThrow(() => ajv.compile(resultSchema));
  const fileDigest = (name: string) => `sha256:${createHash("sha256")
    .update(readFileSync(new URL(`../packages/batch-invocation/schemas/${name}`, import.meta.url)))
    .digest("hex")}`;
  assert.equal(BATCH_INVOCATION_REQUEST_SCHEMA_DIGEST, fileDigest("invocation-request.schema.json"));
  assert.equal(BATCH_INVOCATION_RESULT_SCHEMA_DIGEST, fileDigest("invocation-result.schema.json"));
});

test("portable callers produce the exact committed request and result bytes", () => {
  const request = createBatchInvocationRequest(requestInput);
  const requestBytes = encodeBatchInvocationRequest(request);
  assert.equal(
    new TextDecoder().decode(requestBytes),
    readFileSync(new URL("fixtures/batch-invocation-request.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(decodeBatchInvocationRequest(requestBytes), request);

  const result = createBatchInvocationResult(request, {
    terminal: "succeeded",
    recovery: "fresh",
    runtimeReceiptDigest: digest("d"),
    output: { message: "Service remains healthy." },
  });
  const resultBytes = encodeBatchInvocationResult(result);
  assert.equal(
    new TextDecoder().decode(resultBytes),
    readFileSync(new URL("fixtures/batch-invocation-result.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(decodeBatchInvocationResult(resultBytes, request), result);
  assert.throws(
    () => (decodeBatchInvocationResult as unknown as (input: Uint8Array) => unknown)(resultBytes),
    /request/u,
  );
});

test("request validation is strict, bounded, and digest-correlated", () => {
  const request = createBatchInvocationRequest(requestInput);
  assert.deepEqual(validateBatchInvocationRequest(request), request);
  assert.throws(() => validateBatchInvocationRequest({ ...request, destination: "telegram" }), /unknown field/u);
  assert.throws(() => validateBatchInvocationRequest({ ...request, inputDigest: digest("f") }), /inputDigest/u);
  assert.throws(() => createBatchInvocationRequest({ ...requestInput, attempt: 4 }), /attempt/u);
  assert.throws(
    () => createBatchInvocationRequest({ ...requestInput, input: { body: "x".repeat(262_145) } }),
    /byte limit/u,
  );
  assert.throws(() => createBatchInvocationRequest({
    ...requestInput,
    input: { get body() { return "mutable"; } },
  }), /enumerable data field/u);
  const nonCanonical = new TextEncoder().encode(`${JSON.stringify(request)}\n`);
  assert.throws(() => decodeBatchInvocationRequest(nonCanonical), /canonical JSON bytes/u);
});

test("one invocation callback receives canonical bytes and cannot return a cross-request result", async () => {
  const request = createBatchInvocationRequest(requestInput);
  const expectedBytes = encodeBatchInvocationRequest(request);
  const accepted = await invokeBatch(request, async (bytes) => {
    assert.deepEqual(bytes, expectedBytes);
    return encodeBatchInvocationResult(createBatchInvocationResult(request, {
      terminal: "succeeded",
      recovery: "fresh",
      runtimeReceiptDigest: digest("d"),
      output: { message: "accepted" },
    }));
  });
  assert.equal(accepted.terminal, "succeeded");
  assert.throws(() => validateBatchInvocationResult({
    ...accepted,
    output: { message: "changed" },
  }, request), /outputDigest/u);

  const other = createBatchInvocationRequest({ ...requestInput, invocationId: "other-invocation" });
  await assert.rejects(
    invokeBatch(request, async () => encodeBatchInvocationResult(createBatchInvocationResult(other, {
      terminal: "succeeded",
      recovery: "fresh",
      runtimeReceiptDigest: digest("e"),
      output: { message: "wrong request" },
    }))),
    /invocationId/u,
  );

  const acceptedRecord = accepted as unknown as Record<string, unknown>;
  for (const [field, value] of [
    ["invocationId", "changed-invocation"],
    ["attempt", 2],
    ["applicationDigest", digest("f")],
    ["applicationIdentityDigest", digest("f")],
    ["inputDigest", digest("f")],
  ] as const) {
    const changed = { ...acceptedRecord, [field]: value };
    assert.throws(
      () => decodeBatchInvocationResult(encodeBatchInvocationResult(changed as never), request),
      new RegExp(field, "u"),
    );
  }

  for (const application of [
    { ...requestInput.application, id: "another-application" },
    { ...requestInput.application, inputSchemaDigest: digest("e") },
    { ...requestInput.application, outputSchemaDigest: digest("e") },
  ]) {
    const foreignRequest = createBatchInvocationRequest({ ...requestInput, application });
    const foreignResult = createBatchInvocationResult(foreignRequest, {
      terminal: "succeeded",
      recovery: "fresh",
      runtimeReceiptDigest: digest("d"),
      output: { message: "foreign contract" },
    });
    assert.throws(
      () => validateBatchInvocationResult(foreignResult, request),
      /applicationIdentityDigest/u,
    );
  }
});

test("every terminal result has one exact retry and output disposition", () => {
  const request = createBatchInvocationRequest(requestInput);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const resultSchema = JSON.parse(readFileSync(
    new URL("../packages/batch-invocation/schemas/invocation-result.schema.json", import.meta.url),
    "utf8",
  ));
  const validateResultSchema = ajv.compile(resultSchema);
  const expected = new Map<BatchInvocationTerminal, boolean>([
    ["succeeded", false],
    ["invalid-input", false],
    ["invalid-output", false],
    ["timed-out", true],
    ["cancelled", false],
    ["model-unavailable", true],
    ["overlap-refused", true],
    ["interrupted", true],
  ]);
  assert.deepEqual([...BATCH_INVOCATION_TERMINALS], [...expected.keys()]);
  for (const [terminal, retryable] of expected) {
    const result = terminal === "succeeded"
      ? createBatchInvocationResult(request, {
        terminal,
        recovery: "fresh",
        runtimeReceiptDigest: digest("d"),
        output: { accepted: true },
      })
      : createBatchInvocationResult(request, {
        terminal,
        recovery: terminal === "interrupted" ? "resumed" : "fresh",
        runtimeReceiptDigest: digest("d"),
      });
    assert.equal(result.retryable, retryable, terminal);
    assert.equal("output" in result, terminal === "succeeded", terminal);
    assert.deepEqual(validateBatchInvocationResult(result, request), result);
    assert.equal(validateResultSchema(result), true, `${terminal}: ${ajv.errorsText(validateResultSchema.errors)}`);
    const mismatched = { ...result, retryable: !retryable };
    assert.equal(validateResultSchema(mismatched), false, terminal);
    assert.throws(() => validateBatchInvocationResult(mismatched, request), /retryable/u);
  }
});

test("retry attempts preserve invocation correlation while remaining distinct", () => {
  const first = createBatchInvocationRequest(requestInput);
  const second = createBatchInvocationRequest({ ...requestInput, attempt: 2 });
  assert.equal(first.invocationId, second.invocationId);
  assert.equal(first.inputDigest, second.inputDigest);
  assert.notDeepEqual(encodeBatchInvocationRequest(first), encodeBatchInvocationRequest(second));

  const overlap = createBatchInvocationResult(second, {
    terminal: "overlap-refused",
    recovery: "fresh",
    runtimeReceiptDigest: digest("e"),
  });
  assert.equal(overlap.retryable, true);
  assert.equal(overlap.attempt, 2);

  const resumed = createBatchInvocationResult(second, {
    terminal: "interrupted",
    recovery: "resumed",
    runtimeReceiptDigest: digest("f"),
  });
  assert.equal(resumed.recovery, "resumed");
  assert.equal(resumed.retryable, true);
});
