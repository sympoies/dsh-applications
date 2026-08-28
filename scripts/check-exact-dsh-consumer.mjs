import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dshRoot = process.env.DSH_ROOT === undefined ? undefined : resolve(process.env.DSH_ROOT);

if (dshRoot === undefined) {
  throw new Error("DSH_ROOT is required for the exact DSH consumer check");
}

const compiler = join(dshRoot, "node_modules", ".bin", "tsc");

async function exactDshPackagePaths() {
  const paths = {};
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const manifest = entries.find(entry => entry.isFile() && entry.name === "package.json");
    if (manifest !== undefined) {
      const parsed = JSON.parse(await readFile(join(directory, manifest.name), "utf8"));
      if (typeof parsed.name === "string" && parsed.name.startsWith("@deepseek-ai/")) {
        const types = typeof parsed.types === "string" ? parsed.types : "lib/types/index.d.ts";
        paths[parsed.name] = [relative(applicationRoot, join(directory, types))];
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ["node_modules", "lib", "dist", ".git"].includes(entry.name)) continue;
      await visit(join(directory, entry.name));
    }
  }
  await visit(join(dshRoot, "vendor"));
  await visit(join(dshRoot, "packages"));
  return paths;
}
const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-applications-types-"));
try {
  const configPath = join(temporaryRoot, "tsconfig.json");
  await writeFile(configPath, `${JSON.stringify({
    compilerOptions: {
      target: "ES2024",
      lib: ["ESNext"],
      types: ["node"],
      typeRoots: [join(dshRoot, "node_modules", "@types")],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      baseUrl: applicationRoot,
      ignoreDeprecations: "6.0",
      paths: {
        ...await exactDshPackagePaths(),
        "@sympoies/dsh-manager": ["packages/manager/index.d.ts"],
        "@sympoies/dsh-plugin-sdk": ["packages/plugin-sdk/index.d.ts"],
        "@sympoies/dsh-rc2-adapter": ["packages/dsh-rc2-adapter/index.d.ts"],
      },
    },
    files: [join(applicationRoot, "test", "exact-dsh-consumer.ts")],
  }, null, 2)}\n`, "utf8");
  await execFileAsync(compiler, ["--project", configPath, "--pretty", "false"], {
    cwd: dshRoot,
    timeout: 60_000,
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
