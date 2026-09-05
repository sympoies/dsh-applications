import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "dsh-applications-pack-"));

function pack(destination) {
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: root, encoding: "utf8" },
  );
  const result = JSON.parse(output)[0];
  const bytes = readFileSync(join(destination, result.filename));
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    filename: result.filename,
    files: result.files.map(({ path }) => path).sort(),
    size: bytes.length,
  };
}

try {
  const firstDirectory = join(temporaryRoot, "first");
  const secondDirectory = join(temporaryRoot, "second");
  mkdirSync(firstDirectory);
  mkdirSync(secondDirectory);
  const first = pack(firstDirectory);
  const second = pack(secondDirectory);
  assert.equal(first.filename, second.filename);
  assert.deepEqual(first.files, second.files);
  assert.equal(first.size, second.size);
  assert.equal(first.digest, second.digest, "package archives must be byte-identical");
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      filename: first.filename,
      sha256: first.digest,
      size: first.size,
      file_count: first.files.length,
    })}\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
