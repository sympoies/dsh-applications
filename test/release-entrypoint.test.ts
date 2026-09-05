import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function git(cwd: string, ...arguments_: string[]) {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture({ reviewState = "APPROVED" } = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dsh-applications-release-entrypoint-"));
  const repository = join(temporaryRoot, "repository");
  const remote = join(temporaryRoot, "remote.git");
  const bin = join(temporaryRoot, "bin");
  mkdirSync(join(repository, ".agents/scripts"), { recursive: true });
  mkdirSync(join(repository, "scripts"), { recursive: true });
  mkdirSync(bin);
  cpSync(join(root, ".agents/scripts/release.sh"), join(repository, ".agents/scripts/release.sh"));
  cpSync(
    join(root, "scripts/check-reviewed-release-source.ts"),
    join(repository, "scripts/check-reviewed-release-source.ts"),
  );
  writeFileSync(join(repository, "package.json"), '{"version":"0.1.0","type":"module"}\n');
  git(repository, "init", "--initial-branch=main");
  git(repository, "config", "user.name", "Release Test");
  git(repository, "config", "user.email", "release-test@example.invalid");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "test fixture");
  const head = git(repository, "rev-parse", "HEAD");
  git(temporaryRoot, "init", "--bare", "--initial-branch=main", remote);
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "-u", "origin", "main");

  const fakeGh = join(bin, "gh");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == api && "$*" == *"commits/"*"/pulls"* ]]; then
  cat <<JSON
[[{"number":5,"state":"closed","merged_at":"2026-08-29T00:00:00Z","merge_commit_sha":"${head}","base":{"ref":"main","repo":{"full_name":"sympoies/dsh-applications"}},"head":{"sha":"1111111111111111111111111111111111111111","repo":{"full_name":"sympoies/dsh-applications"}},"user":{"login":"author"}}]]
JSON
elif [[ "$1" == api && "$*" == *"pulls/5/reviews"* ]]; then
  cat <<JSON
[[{"id":7,"state":"${reviewState}","user":{"login":"independent-reviewer"},"commit_id":"1111111111111111111111111111111111111111","submitted_at":"2026-08-29T00:01:00Z"}]]
JSON
elif [[ "$1" == release && "$2" == view ]]; then
  exit 1
else
  printf 'unexpected fake gh call: %s\\n' "$*" >&2
  exit 64
fi
`,
  );
  chmodSync(fakeGh, 0o755);
  return { temporaryRoot, repository, head, bin };
}

test("release entrypoint dry-run verifies reviewed exact source without mutation", () => {
  const context = fixture();
  try {
    const output = execFileSync(
      join(context.repository, ".agents/scripts/release.sh"),
      [
        "--dry-run",
        "--version",
        "0.1.0",
        "--expected-head",
        context.head,
        "--repository",
        "sympoies/dsh-applications",
      ],
      {
        cwd: context.repository,
        encoding: "utf8",
        env: { ...process.env, PATH: `${context.bin}:${process.env.PATH}` },
      },
    );
    assert.match(output, /tag=v0\.1\.0/);
    assert.match(output, /commit=[0-9a-f]{40}/);
    assert.match(output, /status=ready/);
    assert.throws(() => git(context.repository, "rev-parse", "refs/tags/v0.1.0"));
  } finally {
    rmSync(context.temporaryRoot, { recursive: true, force: true });
  }
});

test("release entrypoint rejects a source without independent exact-head approval", () => {
  const context = fixture({ reviewState: "CHANGES_REQUESTED" });
  try {
    assert.throws(
      () =>
        execFileSync(
          join(context.repository, ".agents/scripts/release.sh"),
          [
            "--dry-run",
            "--version",
            "0.1.0",
            "--expected-head",
            context.head,
            "--repository",
            "sympoies/dsh-applications",
          ],
          {
            cwd: context.repository,
            stdio: "pipe",
            env: { ...process.env, PATH: `${context.bin}:${process.env.PATH}` },
          },
        ),
      /Command failed/,
    );
  } finally {
    rmSync(context.temporaryRoot, { recursive: true, force: true });
  }
});
