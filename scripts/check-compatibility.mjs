import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expectedRuntimeKitRevision =
  "2cd14d5fdd73e0758d366d8b671f71ee768d857f";
const expectedDshRevision = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArguments(argv) {
  const result = { manifestOnly: false };
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

function git(checkout, ...arguments_) {
  return execFileSync("git", ["-C", checkout, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalizeRepository(url) {
  return url.replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/$/, "");
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
  assert.equal(git(options.runtimeKitRoot, "rev-parse", "HEAD"), lock.runtime_kit.revision);
  assert.equal(git(options.dshRoot, "rev-parse", "HEAD"), lock.dsh.revision);
  assert.equal(git(options.runtimeKitRoot, "status", "--porcelain"), "");
  assert.equal(git(options.dshRoot, "status", "--porcelain"), "");
  assert.equal(
    normalizeRepository(git(options.runtimeKitRoot, "remote", "get-url", "origin")),
    normalizeRepository(lock.runtime_kit.repository),
  );
  assert.equal(
    normalizeRepository(git(options.dshRoot, "remote", "get-url", "origin")),
    normalizeRepository(lock.dsh.repository),
  );

  const runtimePackage = load(resolve(options.runtimeKitRoot, "package.json"));
  assert.equal(runtimePackage.name, lock.runtime_kit.package);
  for (const requiredExport of lock.runtime_kit.required_exports) {
    assert.equal(typeof runtimePackage.exports?.[requiredExport], "string");
  }

  const runtimeCompatibility = load(
    resolve(options.runtimeKitRoot, lock.runtime_kit.dsh_compatibility_manifest),
  );
  assert.deepEqual(runtimeCompatibility.channels?.pinned, {
    ref: lock.dsh.ref,
    revision: lock.dsh.revision,
    version: lock.dsh.version,
  });

  const dshPackage = load(resolve(options.dshRoot, "package.json"));
  assert.equal(dshPackage.name, "@deepseek-ai/dsh-root");
  assert.equal(dshPackage.version, lock.dsh.version);
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
