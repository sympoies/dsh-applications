import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const expectedRuntimeKitRevision =
  "2cd14d5fdd73e0758d366d8b671f71ee768d857f";
const expectedDshRevision = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";
const reviewedFixtureCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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
  assert.equal(pkg.version, "0.3.0");
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.workspaces, ["packages/*"]);
  assert.equal(pkg.packageManager, "npm@11.6.2");
  assert.equal(pkg.engines.node, ">=24.0.0");
  assert.equal(pkg.scripts.test, "node --test test/*.test.mjs");
  assert.equal(pkg.scripts["test:manager-contract"], "node --test test/manager-contract.test.mjs");
  assert.equal(pkg.scripts["test:manager-faults"], "node --test test/manager-faults.test.mjs");
  assert.equal(pkg.scripts["test:plugin-sandbox"], "node --test test/plugin-sandbox.test.mjs");
  assert.equal(pkg.scripts["test:profiles"], "node --test test/profiles.test.mjs");
  assert.equal(pkg.scripts["test:profile-compatibility"], "node scripts/check-profile-compatibility.mjs");
  assert.equal(pkg.scripts["test:integration"], "node --test test/integration.test.mjs");
  assert.equal(pkg.scripts["test:github-contracts"], "node --test test/github-contracts.test.mjs");
  assert.equal(pkg.scripts["check:compatibility"], "node scripts/check-compatibility.mjs");
  assert.equal(pkg.scripts["verify:package-reproducibility"], "node scripts/check-package-reproducibility.mjs");
  assert.equal(pkg.scripts["test:package"], "npm run check:compatibility -- --manifest-only && npm run verify:package-reproducibility && npm pack --dry-run --ignore-scripts");
  assert.deepEqual(pkg.files, ["AGENTS.md", "SECURITY.md", "CONTRIBUTING.md", "compatibility", "docs", "fixtures", "profiles", "packages"]);

  const packageLock = json("package-lock.json");
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.packages[""].packageManager, undefined);
  assert.equal(packageLock.packages[""].name, pkg.name);
  assert.deepEqual(packageLock.packages[""].workspaces, pkg.workspaces);
  assert.equal(packageLock.packages[""].version, pkg.version);
  for (const path of [
    "packages/plugin-sdk", "packages/manager", "packages/dsh-rc2-adapter",
    "packages/github-read", "packages/github-review-publish",
  ]) {
    assert.equal(packageLock.packages[path].version, pkg.version);
  }
});

test("workspace packages are components of one coordinated application artifact", () => {
  const architecture = read("docs/architecture.md");
  const releases = read("docs/releases.md");
  const packages = read("packages/README.md");
  assert.match(architecture, /single coordinated public application artifact/i);
  assert.match(releases, /one coordinated version/i);
  assert.match(packages, /share.*root.*version/i);
  assert.doesNotMatch(architecture, /independently versioned/i);
  assert.match(read(".github/workflows/release.yml"), /test "\$package_version" != "0\.0\.0"/);
});

test("installed workspace resolves every actual public package specifier", async () => {
  for (const [specifier, exported] of [
    ["@sympoies/dsh-application-manager", "createApplicationManager"],
    ["@sympoies/dsh-plugin-sdk", "definePlugin"],
    ["@sympoies/dsh-rc2-adapter", "createDshRc2Adapter"],
    ["@sympoies/dsh-github-read", "validateGitHubPullRequestReadBundle"],
    ["@sympoies/dsh-github-review-publish", "createGitHubReviewWorkerResult"],
  ]) {
    const module = await import(specifier);
    assert.equal(typeof module[exported], "function", `${specifier} must resolve from the installed workspace`);
  }
  const githubRead = await import("@sympoies/dsh-github-read");
  const githubPublish = await import("@sympoies/dsh-github-review-publish");
  assert.equal(typeof githubRead.createGitHubReadPluginDescriptor, "function");
  assert.equal(typeof githubPublish.createGitHubReviewPublishPluginDescriptor, "function");
});

test("compatibility lock pins the accepted runtime-kit and DSH identities", () => {
  const lock = json("compatibility/dsh-applications-lock.json");
  assert.equal(lock.schema_version, "dsh-applications.compatibility-lock.v1");
  assert.equal(lock.application_version, "0.3.0");
  assert.deepEqual(lock.profile_catalog, {
    path: "profiles/catalog.json",
    digest: "sha256:66ec510f0c9577d2d3cddd738d06492f68c38f54b803c4885fde1bcde47899d3",
  });
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
  assert.equal(lock.node, "24.16.0");
  assert.equal(lock.package_manager, "npm@11.6.2");

  assert.equal(read(".node-version").trim(), "24.16.0");
  assert.match(read("README.md"), /fnm use/);
  assert.match(read("CONTRIBUTING.md"), /fnm use/);

  const checker = read("scripts/check-compatibility.mjs");
  for (const runtimeOwner of [
    "createCompositionService", "validatePluginDescriptor", "createMemoryRuntimeStore",
    "createWorkloadManager", "createMediatedHostService", "createManagerControlService",
    "validateMediatedHostActionRequest",
  ]) assert.match(checker, new RegExp(runtimeOwner));
  for (const dshOwner of ["agents", "sessions", "sessionPersistence", "tools"]) {
    assert.match(checker, new RegExp(`DSH ${dshOwner}`));
  }
});

test("CI verifies the repository and exact compatibility checkouts", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm install --global npm@11\.6\.2 --ignore-scripts/);
  assert.equal((workflow.match(/node-version: 24\.16\.0/g) ?? []).length, 2);
  assert.match(workflow, /npm run test:repository-contract/);
  assert.match(workflow, /npm run test:manager-contract/);
  assert.match(workflow, /npm run test:manager-faults/);
  assert.match(workflow, /npm run test:plugin-sandbox/);
  assert.match(workflow, /npm run test:profiles/);
  assert.match(workflow, /npm run test:integration/);
  assert.match(workflow, /npm run test:github-contracts/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, new RegExp(`repository: sympoies/dsh-runtime-kit[\\s\\S]*ref: ${expectedRuntimeKitRevision}`));
  assert.match(workflow, new RegExp(`repository: deepseek-ai/deepseek-harness[\\s\\S]*ref: ${expectedDshRevision}`));
  assert.match(workflow, /npm run check:compatibility --/);
  assert.match(workflow, /npm run test:profile-compatibility --/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s@]+@(main|master|v\d+)\b/);
});

test("tag release publishes digest-addressed, attested immutable assets", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /node-version: 24\.16\.0/);
  assert.match(workflow, /tags:\n\s+- ['"]v\*['"]/);
  assert.match(workflow, /permissions:[\s\S]*contents: write[\s\S]*id-token: write[\s\S]*attestations: write/);
  assert.match(workflow, /verify-tag/);
  const restoreTag = workflow.indexOf(
    'git fetch --force --no-tags origin "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"',
  );
  const inspectTag = workflow.indexOf('git cat-file -t "refs/tags/$RELEASE_TAG"');
  assert(restoreTag >= 0, "release must restore the annotated tag ref after checkout");
  assert(restoreTag < inspectTag, "annotated tag restoration must precede object-type verification");
  assert.match(workflow, /git\/tags\/\$tag_object/);
  assert.match(workflow, /\.verification\.verified/);
  assert.match(workflow, /\.verification\.reason/);
  assert.match(
    workflow,
    /git fetch --no-tags origin main:refs\/remotes\/origin\/main/,
    "tag checkout must materialize the remote-tracking main ref before ancestry verification",
  );
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

test("release verification is read-only and privileged publish runs no project code", () => {
  const workflow = read(".github/workflows/release.yml");
  const verifyStart = workflow.indexOf("  verify-build:");
  const publishStart = workflow.indexOf("  publish:");
  assert(verifyStart >= 0, "verify-build job is required");
  assert(publishStart > verifyStart, "publish must follow verify-build");
  const verifyJob = workflow.slice(verifyStart, publishStart);
  const publishJob = workflow.slice(publishStart);

  assert.match(verifyJob, /permissions:\n\s+contents: read\n\s+pull-requests: read/);
  assert.doesNotMatch(verifyJob, /contents: write|id-token: write|attestations: write/);
  assert.match(verifyJob, /npm test/);
  assert.match(verifyJob, /Check out fresh exact tagged source/);
  assert.match(verifyJob, /ref: \$\{\{ steps\.verify-tag\.outputs\.release_commit \}\}/);
  assert.match(verifyJob, /scripts\/package-release-artifact\.mjs/);

  assert.match(publishJob, /needs: verify-build/);
  assert.match(publishJob, /permissions:[\s\S]*contents: write[\s\S]*id-token: write[\s\S]*attestations: write/);
  assert.match(publishJob, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(publishJob, /sha256sum -c SHA256SUMS/);
  assert.match(publishJob, /attest-build-provenance/);
  assert.match(publishJob, /gh release create/);
  assert.match(
    publishJob,
    /gh release create[\s\S]*--repo "\$GITHUB_REPOSITORY"/,
    "source-free publish must provide repository identity without a git checkout",
  );
  assert.doesNotMatch(publishJob, /npm (ci|install|run|test|pack)|node scripts\/|actions\/checkout@/);
});

test("reviewed release source requires one merged same-repo PR and independent exact-head approval", () => {
  const checker = join(root, "scripts/check-reviewed-release-source.mjs");
  const fixtureRoot = join(root, "test/fixtures/release-source");
  const accepted = JSON.parse(
    execFileSync(
      process.execPath,
      [
        checker,
        "--repository",
        "sympoies/dsh-applications",
        "--commit",
        reviewedFixtureCommit,
        "--associations",
        join(fixtureRoot, "accepted-associations.json"),
        "--reviews",
        join(fixtureRoot, "accepted-reviews.json"),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.pull_request, 7);
  assert.equal(accepted.reviewed_head, "cccccccccccccccccccccccccccccccccccccccc");
  assert.equal(accepted.approver, "independent-reviewer");

  for (const [associations, reviews] of [
    ["direct-main-associations.json", "direct-main-reviews.json"],
    ["nonmerge-associations.json", "accepted-reviews.json"],
    ["ambiguous-associations.json", "accepted-reviews.json"],
    ["accepted-associations.json", "unapproved-reviews.json"],
  ]) {
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          checker,
          "--repository",
          "sympoies/dsh-applications",
          "--commit",
          reviewedFixtureCommit,
          "--associations",
          join(fixtureRoot, associations),
          "--reviews",
          join(fixtureRoot, reviews),
        ],
        { stdio: "pipe" },
      ),
    );
  }

  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /commits\/\$release_commit\/pulls/);
  assert.match(workflow, /pulls\/\$pr_number\/reviews/);
  assert.match(workflow, /gh api --paginate --slurp[\s\S]*commits\/\$release_commit\/pulls[\s\S]*jq 'add'/);
  assert.match(workflow, /gh api --paginate --slurp[\s\S]*pulls\/\$pr_number\/reviews[\s\S]*jq 'add'/);
  assert.match(workflow, /check-reviewed-release-source\.mjs/);
});

test("release packaging rejects dirty source and emits a flat verifiable checksum", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dsh-applications-release-contract-"));
  const sourceRoot = join(temporaryRoot, "source");
  const cleanOutput = join(temporaryRoot, "clean-output");
  const dirtyOutput = join(temporaryRoot, "dirty-output");
  try {
    execFileSync("git", ["clone", "--local", "--no-hardlinks", root, sourceRoot], {
      stdio: "pipe",
    });
    const sourceHead = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "scripts/package-release-artifact.mjs",
          "--source-root",
          sourceRoot,
          "--expected-commit",
          sourceHead,
          "--out",
          cleanOutput,
        ],
        { cwd: root, encoding: "utf8" },
      ),
    );
    assert.equal(result.ok, true);
    assert(!result.archive.includes("/"));
    const checksum = readFileSync(join(cleanOutput, "SHA256SUMS"), "utf8");
    assert.equal(checksum, `${result.sha256}  ${result.archive}\n`);
    execFileSync("sha256sum", ["-c", "SHA256SUMS"], {
      cwd: cleanOutput,
      stdio: "pipe",
    });

    writeFileSync(join(sourceRoot, "README.md"), "deterministic mutation\n", {
      flag: "a",
    });
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            "scripts/package-release-artifact.mjs",
            "--source-root",
            sourceRoot,
            "--expected-commit",
            sourceHead,
            "--out",
            dirtyOutput,
          ],
          { cwd: root, stdio: "pipe" },
        ),
      /source checkout is dirty/,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("compatibility validator accepts the manifest-only bootstrap contract", () => {
  execFileSync(process.execPath, ["scripts/check-compatibility.mjs", "--manifest-only"], {
    cwd: root,
    stdio: "pipe",
  });
});

test("the repository package is reproducible and contains the public coordinated catalog", () => {
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
  assert(paths.includes("profiles/catalog.json"));
  assert(paths.includes("profiles/batch/profile.json"));
  assert(paths.includes("profiles/coding/profile.json"));
  assert(paths.includes("profiles/conversational/profile.json"));
  assert(paths.includes("profiles/github-pr-review/profile.json"));
  assert(paths.includes("fixtures/triggers/manual.json"));
  assert(paths.includes("fixtures/triggers/schedule.json"));
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
    assert.doesNotMatch(content, /deploymentBinding|installation(Id)?|secretValue|privateTopology/);
  }

  assert(!tracked.some((path) => /(^|\/)(Dockerfile|compose\.ya?ml|Chart\.yaml)$/.test(path)));
  assert(!tracked.some((path) => /\.(service|socket|timer|tf|tfvars)$/.test(path)));
});
