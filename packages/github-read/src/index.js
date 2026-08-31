import { definePlugin } from "@sympoies/dsh-plugin-sdk";

export const GITHUB_REVIEW_TRIGGER_SCHEMA_DIGEST = "sha256:2d8aa351df22e1435eaf1ae427bc45a96c46f5a31bb29a97813c2b0447c81386";
export const GITHUB_PULL_REQUEST_READ_BUNDLE_SCHEMA_DIGEST = "sha256:a7f8780d067efb35df08f8f61e673e6586dc7fb812c3563674fc05825fdfb0f6";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HEAD_SHA = /^[0-9a-f]{40}$/u;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const BINDING_FIELDS = Object.freeze([
  "capsuleDigest", "requestId", "target", "headSha", "pathSetDigest",
  "generation", "instance", "outputSchemaDigest", "admissionId", "publisherEpoch",
]);

function fail(message) {
  throw new TypeError(message);
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function boundedString(value, label, maximumBytes, { nonempty = true } = {}) {
  if (typeof value !== "string" || (nonempty && value.length === 0)
    || Buffer.byteLength(value, "utf8") > maximumBytes) fail(`${label} is invalid or too long`);
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a lowercase sha256 digest`);
}

function uint64(value, label) {
  if (typeof value !== "string" || !UINT64.test(value) || BigInt(value) > UINT64_MAX) {
    fail(`${label} must be a canonical uint64 decimal string`);
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) fail(`${label} must be a positive integer`);
}

function path(value, label) {
  boundedString(value, label, 1024);
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")
    || value.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
    fail(`${label} must be a normalized repository-relative path`);
  }
}

function sortedUniqueIntegers(value, label) {
  if (!Array.isArray(value) || value.length > 10_000) fail(`${label} must be a bounded array`);
  let previous = 0;
  value.forEach((line, index) => {
    positiveInteger(line, `${label}[${index}]`);
    if (line <= previous) fail(`${label} must be sorted and unique`);
    previous = line;
  });
}

function validateBinding(value, label = "readBundle") {
  digest(value.capsuleDigest, `${label}.capsuleDigest`);
  for (const field of ["requestId", "target", "generation", "instance", "admissionId"]) {
    boundedString(value[field], `${label}.${field}`, 256);
  }
  if (typeof value.headSha !== "string" || !HEAD_SHA.test(value.headSha)) fail(`${label}.headSha is invalid`);
  digest(value.pathSetDigest, `${label}.pathSetDigest`);
  digest(value.outputSchemaDigest, `${label}.outputSchemaDigest`);
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

export function validateGitHubPullRequestReadBundle(input) {
  const value = record(input, "readBundle");
  exactKeys(value, [
    ...BINDING_FIELDS, "trigger", "pullRequest", "files", "threads",
  ], [], "readBundle");
  validateBinding(value);

  const trigger = record(value.trigger, "readBundle.trigger");
  if (trigger.kind === "pull-request-opened") {
    exactKeys(trigger, ["kind"], [], "readBundle.trigger");
  } else if (trigger.kind === "review-command") {
    exactKeys(trigger, ["kind", "command"], [], "readBundle.trigger");
    if (trigger.command !== "@mes_bot review") fail("readBundle.trigger.command is invalid");
  } else {
    fail("readBundle.trigger.kind is invalid");
  }

  const pullRequest = record(value.pullRequest, "readBundle.pullRequest");
  exactKeys(pullRequest, ["title", "body"], [], "readBundle.pullRequest");
  boundedString(pullRequest.title, "readBundle.pullRequest.title", 8192, { nonempty: false });
  boundedString(pullRequest.body, "readBundle.pullRequest.body", 65_536, { nonempty: false });

  if (!Array.isArray(value.files) || value.files.length > 512) fail("readBundle.files must be a bounded array");
  const linesByPath = new Map();
  value.files.forEach((candidate, index) => {
    const file = record(candidate, `readBundle.files[${index}]`);
    exactKeys(file, ["path", "lines"], [], `readBundle.files[${index}]`);
    path(file.path, `readBundle.files[${index}].path`);
    if (linesByPath.has(file.path)) fail("readBundle.files paths must be unique");
    sortedUniqueIntegers(file.lines, `readBundle.files[${index}].lines`);
    linesByPath.set(file.path, new Set(file.lines));
  });

  if (!Array.isArray(value.threads) || value.threads.length > 512) fail("readBundle.threads must be a bounded array");
  value.threads.forEach((candidate, index) => {
    const thread = record(candidate, `readBundle.threads[${index}]`);
    exactKeys(thread, ["path", "line", "author", "body"], [], `readBundle.threads[${index}]`);
    path(thread.path, `readBundle.threads[${index}].path`);
    positiveInteger(thread.line, `readBundle.threads[${index}].line`);
    boundedString(thread.author, `readBundle.threads[${index}].author`, 256);
    boundedString(thread.body, `readBundle.threads[${index}].body`, 16_384, { nonempty: false });
    if (!linesByPath.get(thread.path)?.has(thread.line)) {
      fail(`readBundle.threads[${index}] is not bound to a server-provided diff path and line`);
    }
  });
  return freezeClone(value);
}

export function isCompatibilityReviewTrigger(trigger) {
  return trigger?.kind === "review-command" && trigger.command === "@mes_bot review";
}

export function createGitHubReadPluginDescriptor(runtimeKit, artifactIdentity) {
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
    metadata: { id: "github-read", version: "0.3.0", digest: `sha256:${"0".repeat(64)}` },
    artifact: {
      package: "@sympoies/dsh-github-read",
      digest: artifact.digest,
      entrypoint: "packages/github-read/src/index.js",
      sourceRevision: artifact.sourceRevision,
      attestationIdentity: artifact.attestationIdentity,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"],
    },
    capabilities: {
      provides: ["github.pull-request.read"], requires: [], tools: [], skills: [], services: [], dependencies: [],
    },
    actions: [{
      id: "github.pull-request.read",
      class: "read",
      inputSchemaDigest: GITHUB_REVIEW_TRIGGER_SCHEMA_DIGEST,
      outputSchemaDigest: GITHUB_PULL_REQUEST_READ_BUNDLE_SCHEMA_DIGEST,
      sideEffect: "none",
      idempotency: "supported",
      capability: "github.pull-request.read",
    }],
    configuration: { schemaDigest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", defaults: {} },
    mediation: {
      filesystem: [], network: [], subprocess: [], credentialHandleClasses: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
    },
    health: { probes: [{ id: "github-read.ready", requirement: "required" }] },
    composition: {
      conflicts: [], cardinality: { min: 1, max: 1 }, namespaceClaims: ["github.pull-request.read"],
      ordering: { before: ["github-review-publish"], after: [] },
    },
    lifecycle: {
      readiness: "required", interrupt: "supported", drain: "required",
      disposal: "required", recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = runtimeKit.computeDocumentDigest(descriptor);
  return definePlugin(runtimeKit, descriptor);
}
