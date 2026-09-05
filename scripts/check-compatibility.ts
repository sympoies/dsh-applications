import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const expectedRuntimeKitRevision =
  "2cd14d5fdd73e0758d366d8b671f71ee768d857f";
const expectedDshRevision = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";

type CompatibilityOptions = {
  manifestOnly: boolean;
  runtimeKitRoot?: string;
  dshRoot?: string;
};

function load(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArguments(argv: string[]): CompatibilityOptions {
  const result: CompatibilityOptions = { manifestOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest-only") {
      result.manifestOnly = true;
    } else if (argument === "--runtime-kit-root" || argument === "--dsh-root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      const key = argument === "--runtime-kit-root" ? "runtimeKitRoot" : "dshRoot";
      if (result[key]) throw new Error(`${argument} may be provided only once`);
      result[key] = resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (result.manifestOnly && (result.runtimeKitRoot || result.dshRoot)) {
    throw new Error("--manifest-only cannot be combined with checkout paths");
  }
  if (!result.manifestOnly && (!result.runtimeKitRoot || !result.dshRoot)) {
    throw new Error("provide both --runtime-kit-root and --dsh-root, or --manifest-only");
  }
  return result;
}

function git(checkout: string, ...arguments_: string[]) {
  return execFileSync("git", ["-C", checkout, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalizeRepository(url: string) {
  return url.replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/$/, "");
}

function source(path: string) {
  return readFileSync(path, "utf8");
}

function assertMethods(owner: Record<string, unknown>, names: string[], label: string) {
  for (const name of names) assert.equal(typeof owner[name], "function", `${label}.${name} is required`);
}

function assertSourceMethods(contents: string, patterns: Record<string, RegExp>, label: string) {
  for (const [name, pattern] of Object.entries(patterns) as [string, RegExp][]) {
    assert.match(contents, pattern, `${label}.${name} declaration is required`);
  }
}

const options = parseArguments(process.argv.slice(2));
const lock = load(resolve(root, "compatibility/dsh-applications-lock.json"));

assert.equal(lock.schema_version, "dsh-applications.compatibility-lock.v1");
assert.equal(lock.runtime_kit.revision, expectedRuntimeKitRevision);
assert.equal(lock.dsh.revision, expectedDshRevision);
assert.match(lock.runtime_kit.revision, /^[0-9a-f]{40}$/);
assert.match(lock.dsh.revision, /^[0-9a-f]{40}$/);
assert.equal(normalizeRepository(lock.runtime_kit.repository), "https://github.com/sympoies/dsh-runtime-kit");
assert.equal(normalizeRepository(lock.dsh.repository), "https://github.com/deepseek-ai/deepseek-harness");
assert.equal(lock.dsh.ref, "refs/tags/dsh-v0.1.1-rc.2");
assert.equal(lock.dsh.version, "0.1.1-rc.2");
assert.deepEqual(lock.runtime_kit.required_exports, ["./composition", "./manager"]);

if (!options.manifestOnly) {
  const runtimeKitRoot = options.runtimeKitRoot;
  const dshRoot = options.dshRoot;
  assert(runtimeKitRoot !== undefined && dshRoot !== undefined);
  assert.equal(git(runtimeKitRoot, "rev-parse", "HEAD"), lock.runtime_kit.revision);
  assert.equal(git(dshRoot, "rev-parse", "HEAD"), lock.dsh.revision);
  assert.equal(git(runtimeKitRoot, "status", "--porcelain"), "");
  assert.equal(git(dshRoot, "status", "--porcelain"), "");
  assert.equal(
    normalizeRepository(git(runtimeKitRoot, "remote", "get-url", "origin")),
    normalizeRepository(lock.runtime_kit.repository),
  );
  assert.equal(
    normalizeRepository(git(dshRoot, "remote", "get-url", "origin")),
    normalizeRepository(lock.dsh.repository),
  );

  const runtimePackage = load(resolve(runtimeKitRoot, "package.json"));
  assert.equal(runtimePackage.name, lock.runtime_kit.package);
  for (const requiredExport of lock.runtime_kit.required_exports) {
    assert.equal(typeof runtimePackage.exports?.[requiredExport], "string");
  }
  const runtimeComposition = await import(pathToFileURL(resolve(runtimeKitRoot, runtimePackage.exports["./composition"])).href);
  const runtimeManager = await import(pathToFileURL(resolve(runtimeKitRoot, runtimePackage.exports["./manager"])).href);
  assertMethods(runtimeComposition, [
    "computeDocumentDigest", "createCompositionService", "parseCanonicalJsonText",
    "validateBotProfile", "validatePluginDescriptor",
  ], "runtime-kit composition");
  assertMethods(runtimeManager, [
    "createMemoryRuntimeStore", "createWorkloadManager", "createMediatedHostService",
    "createManagerControlService", "validateMediatedHostActionRequest",
  ], "runtime-kit manager");

  const runtimeCompatibility = load(
    resolve(runtimeKitRoot, lock.runtime_kit.dsh_compatibility_manifest),
  );
  assert.deepEqual(runtimeCompatibility.channels?.pinned, {
    ref: lock.dsh.ref,
    revision: lock.dsh.revision,
    version: lock.dsh.version,
  });

  const dshPackage = load(resolve(dshRoot, "package.json"));
  assert.equal(dshPackage.name, "@deepseek-ai/dsh-root");
  assert.equal(dshPackage.version, lock.dsh.version);
  const agentSource = source(resolve(dshRoot, "packages/core/agent/src/index.ts"));
  const agentRuntimeSource = source(resolve(dshRoot, "packages/core/agent/src/runtime-types.ts"));
  const sessionSource = source(resolve(dshRoot, "packages/core/session/src/index.ts"));
  const persistenceSource = source(resolve(dshRoot, "packages/session/session-persistence/src/index.ts"));
  const toolsSource = source(resolve(dshRoot, "packages/core/tools/src/index.ts"));
  assertSourceMethods(agentSource, {
    create: /\basync\s+create\s*\(/u,
    resume: /\basync\s+resume\s*\(/u,
    get: /\bget\s*\(\s*id\s*:\s*SessionId/u,
    dispose: /\bdispose\s*\(\s*\)\s*:\s*Promise<void>/u,
  }, "DSH agents");
  assertSourceMethods(agentRuntimeSource, {
    cancel: /\bcancel\s*\(\s*cause\s*:\s*AgentCancelCause/u,
    whenIdle: /\bwhenIdle\s*\(\s*\)\s*:\s*Promise<void>/u,
  }, "DSH agent handle");
  assertSourceMethods(sessionSource, { flush: /\bflush\s*\(\s*session\s*:\s*Session/u }, "DSH sessions");
  assertSourceMethods(persistenceSource, {
    inspect: /\babstract\s+inspect\s*\(/u,
    list: /\babstract\s+list\s*\(/u,
  }, "DSH sessionPersistence");
  assertSourceMethods(toolsSource, {
    register: /\bregister\s*\(/u,
    restrict: /\brestrict\s*\(/u,
    guard: /\bguard\s*\(/u,
    execute: /\basync\s+execute\s*\(/u,
  }, "DSH tools");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: options.manifestOnly ? "manifest-only" : "checkout",
    runtime_kit_revision: lock.runtime_kit.revision,
    dsh_revision: lock.dsh.revision,
    dsh_version: lock.dsh.version,
  })}\n`,
);
