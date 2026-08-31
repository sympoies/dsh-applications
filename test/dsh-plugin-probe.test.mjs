import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = join(projectRoot, "scripts", "dsh-plugin-probe.sh");

const probe = (...args) =>
  spawnSync(scriptPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });

const freshWorkdir = () => join(mkdtempSync(join(tmpdir(), "dsh-plugin-probe-")), "probe");

test("probe enforces its argument contract", () => {
  const missingPackage = probe();
  assert.equal(missingPackage.status, 2);
  assert.match(missingPackage.stderr, /usage:/);

  for (const invalidName of [
    "../evil",
    "UPPER-case",
    "a b",
    "@scope",
    "@scope/",
    "-leading-dash",
    "name/with/extra",
    "@/name",
  ]) {
    const invalid = probe(invalidName, "--dry-run");
    assert.equal(invalid.status, 2, invalidName);
    // A dash-leading token is rejected as an unknown option; every other
    // malformed token is rejected by the package-name validator.
    assert.match(invalid.stderr, /package name|usage:/, invalidName);
  }

  const unknownOption = probe("dsh-telegram-multiagent", "--bogus");
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /usage:/);

  const extraArgument = probe("dsh-telegram-multiagent", "unexpected", "--dry-run");
  assert.equal(extraArgument.status, 2);
  assert.match(extraArgument.stderr, /usage:/);

  const invalidVersion = probe("dsh-telegram-multiagent", "--version", "1.0.0; rm -rf /", "--dry-run");
  assert.equal(invalidVersion.status, 2);
  assert.match(invalidVersion.stderr, /version/);
});

test("probe refuses a non-empty workdir", () => {
  const workdir = freshWorkdir();
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, "keep.txt"), "existing state\n");
  const refused = probe("dsh-telegram-multiagent", "--workdir", workdir, "--dry-run");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /not empty/);
});

test("probe dry-run renders an isolated probe profile and the command plan", () => {
  const workdir = freshWorkdir();
  const dryRun = probe(
    "dsh-telegram-multiagent",
    "--version",
    "1.3.0",
    "--workdir",
    workdir,
    "--dry-run",
  );
  assert.equal(dryRun.status, 0, dryRun.stderr);

  const profileDir = join(workdir, "profiles", "probe");
  const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-headless",
  ]);
  const lock = JSON.parse(
    readFileSync(join(projectRoot, "compatibility", "dsh-applications-lock.json"), "utf8"),
  );
  assert.equal(manifest.dependencies["@deepseek-ai/dsh-base"], lock.dsh.version);
  assert.equal(manifest.dependencies["@deepseek-ai/dsh-headless"], lock.dsh.version);
  assert.equal(manifest.private, true);

  assert.equal(readFileSync(join(profileDir, "cordis.yml"), "utf8").trim(), "[]");
  assert.equal(readFileSync(join(profileDir, ".npmrc"), "utf8").trim(), "ignore-scripts=true");

  const patch = readFileSync(join(profileDir, "cordis.patch.yml"), "utf8");
  assert.match(patch, /"insert"/);
  assert.match(patch, /"name": "dsh-telegram-multiagent"/);
  assert.match(patch, /"disabled": true/);

  // The plan runs entirely inside the probe DSH_HOME and pins the candidate.
  assert.match(dryRun.stdout, /DSH_HOME=/);
  assert.match(dryRun.stdout, new RegExp(workdir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(dryRun.stdout, /plugin --profile probe add dsh-telegram-multiagent@1\.3\.0/);
  // Two composition observations: fail-closed before the insert row, then
  // present and disabled with it.
  assert.match(dryRun.stdout, /ABSENT \(fail-closed\)/);
  assert.match(dryRun.stdout, /PRESENT and disabled: true/);
  // The plan warns about blocked build scripts instead of approving them.
  assert.match(dryRun.stdout, /red flag/);
});

test("probe dry-run defaults the bundle pin from the compatibility lock", () => {
  const workdir = freshWorkdir();
  const dryRun = probe("@ashafizullah/dsh-telegram", "--workdir", workdir, "--dry-run");
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const manifest = JSON.parse(
    readFileSync(join(workdir, "profiles", "probe", "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(join(projectRoot, "compatibility", "dsh-applications-lock.json"), "utf8"),
  );
  assert.equal(manifest.dependencies["@deepseek-ai/dsh-base"], lock.dsh.version);
  // An unpinned candidate is installed at its latest published version.
  assert.match(dryRun.stdout, /plugin --profile probe add @ashafizullah\/dsh-telegram\n|add @ashafizullah\/dsh-telegram(\s|$)/);
  assert.equal(existsSync(join(workdir, "profiles", "probe", "node_modules")), false);
});
