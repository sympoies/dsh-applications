import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

function fail(message: string): never {
  throw new Error(`release artifact invalid: ${message}`);
}

function parseArguments(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      fail("arguments must be --name value pairs");
    }
    if (values.has(flag)) {
      fail(`duplicate argument ${flag}`);
    }
    values.set(flag, value);
  }
  for (const required of ["--source-root", "--expected-commit", "--out"]) {
    if (!values.has(required)) {
      fail(`${required} is required`);
    }
  }
  for (const flag of values.keys()) {
    if (!["--source-root", "--expected-commit", "--out"].includes(flag)) {
      fail(`unknown argument ${flag}`);
    }
  }
  return values;
}

function git(sourceRoot: string, ...arguments_: string[]) {
  return execFileSync("git", ["-C", sourceRoot, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertExactCleanSource(sourceRoot: string, expectedCommit: string) {
  const actualCommit = git(sourceRoot, "rev-parse", "HEAD");
  if (actualCommit !== expectedCommit) {
    fail(`source checkout revision ${actualCommit} does not equal ${expectedCommit}`);
  }
  if (git(sourceRoot, "status", "--porcelain=v1", "--untracked-files=all") !== "") {
    fail("source checkout is dirty");
  }
}

const argumentsByName = parseArguments(process.argv.slice(2));
const sourceRoot = resolve(argumentsByName.get("--source-root")!);
const expectedCommit = argumentsByName.get("--expected-commit")!;
const outputRoot = resolve(argumentsByName.get("--out")!);

if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
  fail("expected commit must be a full lowercase Git revision");
}
if (outputRoot === sourceRoot || outputRoot.startsWith(`${sourceRoot}${sep}`)) {
  fail("output directory must be outside the source checkout");
}
if (existsSync(outputRoot) && readdirSync(outputRoot).length !== 0) {
  fail("output directory must be empty");
}

assertExactCleanSource(sourceRoot, expectedCommit);
mkdirSync(outputRoot, { recursive: true });

const packageResult = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", outputRoot],
    { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
if (!Array.isArray(packageResult) || packageResult.length !== 1) {
  fail("npm pack must produce exactly one archive");
}

const packedName = packageResult[0]?.filename;
if (typeof packedName !== "string" || basename(packedName) !== packedName) {
  fail("npm pack returned an invalid archive name");
}
const packedPath = join(outputRoot, packedName);
const digest = createHash("sha256").update(readFileSync(packedPath)).digest("hex");
const packageVersion = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).version;
if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  fail("package version is not a release version");
}

const archive = `dsh-applications-v${packageVersion}-sha256-${digest}.tgz`;
renameSync(packedPath, join(outputRoot, archive));
writeFileSync(join(outputRoot, "SHA256SUMS"), `${digest}  ${archive}\n`, {
  encoding: "utf8",
  flag: "wx",
});
copyFileSync(
  join(sourceRoot, "compatibility/dsh-applications-lock.json"),
  join(outputRoot, "dsh-applications-lock.json"),
);

execFileSync("sha256sum", ["-c", "SHA256SUMS"], {
  cwd: outputRoot,
  stdio: ["ignore", "pipe", "pipe"],
});
assertExactCleanSource(sourceRoot, expectedCommit);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    source_commit: expectedCommit,
    archive: relative(outputRoot, join(outputRoot, archive)),
    sha256: digest,
    checksum: "SHA256SUMS",
  })}\n`,
);
