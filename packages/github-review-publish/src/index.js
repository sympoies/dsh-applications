import { createHash } from "node:crypto";

import { validateGitHubPullRequestReadBundle } from "@sympoies/dsh-github-read";
import { definePlugin } from "@sympoies/dsh-plugin-sdk";

export const GITHUB_REVIEW_OUTPUT_DIGEST_DOMAIN = "sympoies/github-review-output/v1";
export const GITHUB_REVIEW_WORKER_RESULT_DIGEST_DOMAIN = "sympoies/github-review-worker-result/v1";
export const GITHUB_REVIEW_OUTPUT_MEDIA_TYPE = "application/vnd.sympoies.github-review+json";
export const GITHUB_REVIEW_OUTPUT_SCHEMA_DIGEST = "sha256:667c89a3992e6785aa948872df9b3a6c01f37ad9d33b9e91b2de6282fcbcd21b";
export const GITHUB_REVIEW_WORKER_RESULT_SCHEMA_DIGEST = "sha256:1fdc38955f502267a09219b2474a50d7b518bc6f93741fb44551331a9f029060";
export const MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES = 65_536;

const API_VERSION = "runtime.sympoies.dev/v1";
const KIND = "GitHubReviewWorkerResult";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HEAD_SHA = /^[0-9a-f]{40}$/u;
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BINDING_FIELDS = Object.freeze([
  "capsuleDigest", "requestId", "target", "headSha", "pathSetDigest",
  "generation", "instance", "outputSchemaDigest", "admissionId", "publisherEpoch",
]);
const RESULT_FIELDS = Object.freeze([
  "apiVersion", "kind", "digest", ...BINDING_FIELDS.slice(0, 7),
  "outputMediaType", "outputByteLength", "output", "outputDigest",
  ...BINDING_FIELDS.slice(7),
]);

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

function boundedString(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximumBytes) {
    fail(`${label} is invalid or too long`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function uint64(value, label) {
  if (typeof value !== "string" || !UINT64.test(value) || BigInt(value) > UINT64_MAX) {
    fail(`${label} must be a canonical uint64 decimal string`);
  }
}

function path(value, label) {
  boundedString(value, label, 1024);
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")
    || value.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
    fail(`${label} must be a normalized repository-relative path`);
  }
}

function assertUnicode(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} contains an invalid Unicode surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(`${label} contains an invalid Unicode surrogate`);
    }
  }
}

function assertJsonValue(value, label) {
  const ancestors = new Set();
  const visit = (candidate, pathLabel) => {
    if (candidate === null || typeof candidate === "boolean") return;
    if (typeof candidate === "string") {
      assertUnicode(candidate, pathLabel);
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) fail(`${pathLabel} is not RFC 8785 JSON`);
      return;
    }
    if (typeof candidate !== "object" || ancestors.has(candidate)) fail(`${pathLabel} is not RFC 8785 JSON`);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!isArray && prototype !== Object.prototype && prototype !== null)
      || (isArray && prototype !== Array.prototype)
      || Object.getOwnPropertySymbols(candidate).length !== 0) fail(`${pathLabel} is not RFC 8785 JSON`);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if (isArray) {
      const indexes = keys.filter(key => key !== "length");
      if (indexes.length !== candidate.length) fail(`${pathLabel} is not a dense JSON array`);
      indexes.forEach((key, index) => {
        if (key !== String(index)) fail(`${pathLabel} is not a dense JSON array`);
      });
    }
    ancestors.add(candidate);
    for (const key of keys) {
      if (isArray && key === "length") continue;
      assertUnicode(key, `${pathLabel} key`);
      const descriptor = descriptors[key];
      if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
        fail(`${pathLabel} has a non-data JSON property`);
      }
      visit(descriptor.value, `${pathLabel}.${key}`);
    }
    ancestors.delete(candidate);
  };
  visit(value, label);
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function canonicalizeGitHubReviewJson(value) {
  assertJsonValue(value, "value");
  return canonicalize(value);
}

function domainDigest(domain, value) {
  const hash = createHash("sha256");
  hash.update(domain, "ascii");
  hash.update(Buffer.from([0]));
  hash.update(canonicalizeGitHubReviewJson(value), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

export function computeGitHubReviewOutputDigest(output) {
  return domainDigest(GITHUB_REVIEW_OUTPUT_DIGEST_DOMAIN, output);
}

export function computeGitHubReviewWorkerResultDigest(result) {
  const value = record(result, "workerResult");
  const projection = {};
  for (const key of Object.keys(value)) if (key !== "digest") projection[key] = value[key];
  return domainDigest(GITHUB_REVIEW_WORKER_RESULT_DIGEST_DOMAIN, projection);
}

function validateReviewOutput(value) {
  const output = record(value, "workerResult.output");
  exactKeys(output, ["decision", "reviewReport", "inlineComments"], [], "workerResult.output");
  if (!["APPROVE", "COMMENT", "REQUEST_CHANGES"].includes(output.decision)) {
    fail("workerResult.output.decision is invalid");
  }
  const report = record(output.reviewReport, "workerResult.output.reviewReport");
  exactKeys(report, ["format", "body"], [], "workerResult.output.reviewReport");
  if (report.format !== "agent-kit.specialist-review-report.v1") fail("workerResult output report format is invalid");
  boundedString(report.body, "workerResult.output.reviewReport.body", 49_152);
  const headings = [
    "<!-- agent-kit:specialist-review-report:v1 -->", "## Review Report",
    "### Summary", "### Findings", "### Validation", "### Decision",
  ];
  let cursor = -1;
  for (const heading of headings) {
    const next = report.body.indexOf(heading, cursor + 1);
    if (next < 0) fail(`workerResult output report is missing ${heading}`);
    cursor = next;
  }
  if (!report.body.slice(cursor).includes(output.decision)) fail("workerResult output report decision does not match");

  if (!Array.isArray(output.inlineComments) || output.inlineComments.length > 50) {
    fail("workerResult.output.inlineComments must be a bounded array");
  }
  const locations = new Set();
  output.inlineComments.forEach((candidate, index) => {
    const comment = record(candidate, `workerResult.output.inlineComments[${index}]`);
    exactKeys(comment, ["path", "line", "body"], ["suggestion"], `workerResult.output.inlineComments[${index}]`);
    path(comment.path, `workerResult.output.inlineComments[${index}].path`);
    if (!Number.isSafeInteger(comment.line) || comment.line < 1 || comment.line > 2_147_483_647) {
      fail(`workerResult.output.inlineComments[${index}].line is invalid`);
    }
    boundedString(comment.body, `workerResult.output.inlineComments[${index}].body`, 8192);
    if (comment.suggestion !== undefined) {
      boundedString(comment.suggestion, `workerResult.output.inlineComments[${index}].suggestion`, 16_384);
    }
    const location = `${comment.path}\0${comment.line}`;
    if (locations.has(location)) fail("workerResult output inline locations must be unique");
    locations.add(location);
  });
  return output;
}

function validateBinding(value, label) {
  digest(value.capsuleDigest, `${label}.capsuleDigest`);
  for (const field of ["requestId", "target", "generation", "instance", "admissionId"]) {
    boundedString(value[field], `${label}.${field}`, 256);
  }
  if (typeof value.headSha !== "string" || !HEAD_SHA.test(value.headSha)) fail(`${label}.headSha is invalid`);
  digest(value.pathSetDigest, `${label}.pathSetDigest`);
  digest(value.outputSchemaDigest, `${label}.outputSchemaDigest`);
  if (value.outputSchemaDigest !== GITHUB_REVIEW_OUTPUT_SCHEMA_DIGEST) fail(`${label}.outputSchemaDigest is not the immutable review schema`);
  uint64(value.publisherEpoch, `${label}.publisherEpoch`);
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

function compareReadBinding(result, input) {
  const readBundle = validateGitHubPullRequestReadBundle(input);
  for (const field of BINDING_FIELDS) {
    if (result[field] !== readBundle[field]) fail(`workerResult.${field} does not match the server-bound read bundle`);
  }
  const linesByPath = new Map(readBundle.files.map(file => [file.path, new Set(file.lines)]));
  result.output.inlineComments.forEach((comment, index) => {
    if (!linesByPath.get(comment.path)?.has(comment.line)) {
      fail(`workerResult.output.inlineComments[${index}] path and line are not in the server-bound diff`);
    }
  });
}

export function validateGitHubReviewWorkerResult(input, options = {}) {
  const value = record(input, "workerResult");
  exactKeys(value, RESULT_FIELDS, [], "workerResult");
  if (value.apiVersion !== API_VERSION) fail("workerResult.apiVersion is invalid");
  if (value.kind !== KIND) fail("workerResult.kind is invalid");
  digest(value.digest, "workerResult.digest");
  validateBinding(value, "workerResult");
  if (value.outputMediaType !== GITHUB_REVIEW_OUTPUT_MEDIA_TYPE) fail("workerResult.outputMediaType is invalid");
  if (!Number.isSafeInteger(value.outputByteLength)
    || value.outputByteLength < 0 || value.outputByteLength > MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES) {
    fail("workerResult.outputByteLength is outside the 65,536-byte limit");
  }
  validateReviewOutput(value.output);
  const canonicalOutput = canonicalizeGitHubReviewJson(value.output);
  const actualLength = Buffer.byteLength(canonicalOutput, "utf8");
  if (actualLength !== value.outputByteLength) fail("workerResult output byte length does not match canonical bytes");
  if (computeGitHubReviewOutputDigest(value.output) !== value.outputDigest) fail("workerResult output digest does not match");
  digest(value.outputDigest, "workerResult.outputDigest");
  if (computeGitHubReviewWorkerResultDigest(value) !== value.digest) fail("workerResult digest does not match");
  if (options.readBundle !== undefined) compareReadBinding(value, options.readBundle);
  return freezeClone(value);
}

export function createGitHubReviewWorkerResult({ binding, output, readBundle } = {}) {
  const bound = record(binding, "binding");
  exactKeys(bound, BINDING_FIELDS, [], "binding");
  validateBinding(bound, "binding");
  validateReviewOutput(output);
  const outputByteLength = Buffer.byteLength(canonicalizeGitHubReviewJson(output), "utf8");
  if (outputByteLength > MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES) fail("workerResult output exceeds the 65,536-byte limit");
  const value = {
    apiVersion: API_VERSION,
    kind: KIND,
    digest: `sha256:${"0".repeat(64)}`,
    capsuleDigest: bound.capsuleDigest,
    requestId: bound.requestId,
    target: bound.target,
    headSha: bound.headSha,
    pathSetDigest: bound.pathSetDigest,
    generation: bound.generation,
    instance: bound.instance,
    outputSchemaDigest: bound.outputSchemaDigest,
    outputMediaType: GITHUB_REVIEW_OUTPUT_MEDIA_TYPE,
    outputByteLength,
    output: structuredClone(output),
    outputDigest: computeGitHubReviewOutputDigest(output),
    admissionId: bound.admissionId,
    publisherEpoch: bound.publisherEpoch,
  };
  value.digest = computeGitHubReviewWorkerResultDigest(value);
  return validateGitHubReviewWorkerResult(value, { readBundle });
}

export function createGitHubReviewPublishPluginDescriptor(runtimeKit, artifactIdentity) {
  if (typeof runtimeKit?.computeDocumentDigest !== "function") {
    fail("runtime-kit computeDocumentDigest owner is required");
  }
  const artifact = record(artifactIdentity, "artifactIdentity");
  exactKeys(artifact, ["digest", "sourceRevision", "attestationIdentity"], [], "artifactIdentity");
  digest(artifact.digest, "artifactIdentity.digest");
  if (typeof artifact.sourceRevision !== "string" || !SOURCE_REVISION.test(artifact.sourceRevision)) {
    fail("artifactIdentity.sourceRevision must be an immutable revision");
  }
  boundedString(artifact.attestationIdentity, "artifactIdentity.attestationIdentity", 1024);

  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: { id: "github-review-publish", version: "0.2.1", digest: `sha256:${"0".repeat(64)}` },
    artifact: {
      package: "@sympoies/dsh-github-review-publish",
      digest: artifact.digest,
      entrypoint: "packages/github-review-publish/src/index.js",
      sourceRevision: artifact.sourceRevision,
      attestationIdentity: artifact.attestationIdentity,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"],
    },
    capabilities: {
      provides: ["github.review.publish"], requires: ["github.pull-request.read"],
      tools: [], skills: [], services: [],
      dependencies: [{ id: "github-read", range: ">=0.2.0 <1.0.0", scope: "required" }],
    },
    actions: [{
      id: "github.review.publish",
      class: "write",
      inputSchemaDigest: GITHUB_REVIEW_OUTPUT_SCHEMA_DIGEST,
      outputSchemaDigest: GITHUB_REVIEW_WORKER_RESULT_SCHEMA_DIGEST,
      sideEffect: "idempotent",
      idempotency: "required",
      capability: "github.review.publish",
    }],
    configuration: { schemaDigest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", defaults: {} },
    mediation: {
      filesystem: [], network: [], subprocess: [], credentialHandleClasses: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES },
    },
    health: { probes: [{ id: "github-review-publish.ready", requirement: "required" }] },
    composition: {
      conflicts: [], cardinality: { min: 1, max: 1 }, namespaceClaims: ["github.review.publish"],
      ordering: { before: [], after: ["github-read"] },
    },
    lifecycle: {
      readiness: "required", interrupt: "supported", drain: "required",
      disposal: "required", recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = runtimeKit.computeDocumentDigest(descriptor);
  return definePlugin(runtimeKit, descriptor);
}
