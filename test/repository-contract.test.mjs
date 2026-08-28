import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const expectedRuntimeKitRevision =
  "2cd14d5fdd73e0758d366d8b671f71ee768d857f";
const expectedDshRevision = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function filesBelow(path) {
  const absolute = join(root, path);
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesBelow(relative(root, child)));
    } else if (entry.isFile()) {
      files.push(relative(root, child));
    }
  }
  return files;
}

test("repository carries its public governance boundary", () => {
  for (const path of [
    "AGENTS.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "docs/architecture.md",
    "docs/ownership.md",
    "docs/releases.md",
  ]) {
    assert.equal(statSync(join(root, path)).isFile(), true, `${path} is required`);
  }

  const policy = read("AGENTS.md");
  assert.match(policy, /public.*application/i);
  assert.match(policy, /must not.*private/i);
  assert.match(policy, /DSH.*agent loop/i);
  assert.match(policy, /runtime-kit/i);

  const ownership = read("docs/ownership.md");
  for (const owner of ["DeepSeek Harness", "nils-cli", "dsh-runtime-kit", "dsh-applications", "sympoies-infra", "local-scripts"]) {
    assert.match(ownership, new RegExp(owner));
  }
  assert.match(ownership, /one-way dependency/i);
});

test("workspace metadata is exact, private at the root, and release-safe", () => {
  const pkg = json("package.json");
  assert.equal(pkg.name, "@sympoies/dsh-applications-workspace");
  assert.equal(pkg.version, "0.0.0");
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.workspaces, ["packages/*"]);
  assert.equal(pkg.packageManager, "npm@11.6.2");
  assert.equal(pkg.engines.node, "^22.19.0 || >=24.0.0");
  assert.equal(pkg.scripts.test, "npm run test:repository-contract");
  assert.equal(pkg.scripts["check:compatibility"], "node scripts/check-compatibility.mjs");
  assert.equal(pkg.scripts["verify:package-reproducibility"], "node scripts/check-package-reproducibility.mjs");
  assert.deepEqual(pkg.files, ["AGENTS.md", "SECURITY.md", "CONTRIBUTING.md", "compatibility", "docs", "packages"]);

  const packageLock = json("package-lock.json");
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.packages[""].packageManager, undefined);
  assert.equal(packageLock.packages[""].name, pkg.name);
  assert.deepEqual(packageLock.packages[""].workspaces, pkg.workspaces);
});

test("compatibility lock pins the accepted runtime-kit and DSH identities", () => {
  const lock = json("compatibility/dsh-applications-lock.json");
  assert.equal(lock.schema_version, "dsh-applications.compatibility-lock.v1");
  assert.deepEqual(lock.runtime_kit, {
    package: "@sympoies/dsh-runtime-kit",
    repository: "https://github.com/sympoies/dsh-runtime-kit",
    revision: expectedRuntimeKitRevision,
    required_exports: ["./composition", "./manager"],
    dsh_compatibility_manifest: "compatibility/dsh.json",
  });
  assert.deepEqual(lock.dsh, {
    repository: "https://github.com/deepseek-ai/deepseek-harness",
    ref: "refs/tags/dsh-v0.1.1-rc.2",
    revision: expectedDshRevision,
    version: "0.1.1-rc.2",
  });
  assert.equal(lock.node, "22.19.0");
  assert.equal(lock.package_manager, "npm@11.6.2");
});

test("CI verifies the repository and exact compatibility checkouts", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm install --global npm@11\.6\.2 --ignore-scripts/);
  assert.match(workflow, /npm run test:repository-contract/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, new RegExp(`repository: sympoies/dsh-runtime-kit[\\s\\S]*ref: ${expectedRuntimeKitRevision}`));
  assert.match(workflow, new RegExp(`repository: deepseek-ai/deepseek-harness[\\s\\S]*ref: ${expectedDshRevision}`));
  assert.match(workflow, /npm run check:compatibility --/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s@]+@(main|master|v\d+)\b/);
});

test("tag release publishes digest-addressed, attested immutable assets", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /tags:\n\s+- ['"]v\*['"]/);
  assert.match(workflow, /permissions:[\s\S]*contents: write[\s\S]*id-token: write[\s\S]*attestations: write/);
  assert.match(workflow, /verify-tag/);
  assert.match(workflow, /git\/tags\/\$tag_object/);
  assert.match(workflow, /\.verification\.verified/);
  assert.match(workflow, /\.verification\.reason/);
  assert.match(workflow, /verify:package-reproducibility/);
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /attest-build-provenance/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /gh release (upload|edit)/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s@]+@(main|master|v\d+)\b/);

  const releases = read("docs/releases.md");
  assert.match(releases, /Semantic Versioning/i);
  assert.match(releases, /annotated.*signed tag/i);
  assert.match(releases, /reviewed.*main/i);
  assert.match(releases, /immutable/i);
  assert.match(releases, /SHA256SUMS/);
});

test("compatibility validator accepts the manifest-only bootstrap contract", () => {
  execFileSync(process.execPath, ["scripts/check-compatibility.mjs", "--manifest-only"], {
    cwd: root,
    stdio: "pipe",
  });
});

test("the repository package is reproducible and contains only public bootstrap files", () => {
  execFileSync(process.execPath, ["scripts/check-package-reproducibility.mjs"], {
    cwd: root,
    stdio: "pipe",
  });

  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
    }),
  )[0];
  const paths = packed.files.map(({ path }) => path).sort();
  assert(paths.includes("compatibility/dsh-applications-lock.json"));
  assert(paths.includes("docs/architecture.md"));
  assert(paths.includes("docs/ownership.md"));
  assert(paths.includes("docs/releases.md"));
  assert(paths.includes("packages/README.md"));
  assert(!paths.some((path) => path.startsWith(".github/")));
  assert(!paths.some((path) => path.startsWith("scripts/")));
  assert(!paths.some((path) => path.startsWith("test/")));
});

test("tracked public content contains no credential material or machine-local paths", () => {
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  const secretPatterns = [
    new RegExp(["BEGIN", "PRIVATE", "KEY"].join(" ")),
    new RegExp(["gh", "p_"].join("")),
    new RegExp(["github", "_pat_"].join("")),
    /\/home\/[a-z0-9._-]+\//i,
    /~\/Project\//,
  ];
  for (const path of tracked) {
    if (!statSync(join(root, path)).isFile()) continue;
    const content = read(path);
    for (const pattern of secretPatterns) {
      assert.doesNotMatch(content, pattern, `${path} contains forbidden public material`);
    }
  }

  for (const path of filesBelow("packages")) {
    const content = read(path);
    assert.doesNotMatch(content, /deployment(Id|Binding)|installation(Id)?|secret(Value)?|privateTopology/);
  }

  assert(!tracked.some((path) => /(^|\/)(Dockerfile|compose\.ya?ml|Chart\.yaml)$/.test(path)));
  assert(!tracked.some((path) => /\.(service|socket|timer|tf|tfvars)$/.test(path)));
});
