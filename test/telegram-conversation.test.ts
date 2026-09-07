import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const profileRoot = resolve(root, "profiles/telegram-conversational");
const packageRoot = resolve(root, "packages/telegram-channel");
const exactRuntimeKitRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactDshRoot = process.env.DSH_ROOT === undefined ? undefined : resolve(process.env.DSH_ROOT);

function requireFile(path: string): string {
  assert.equal(existsSync(path), true, `${path.slice(root.length + 1)} must exist`);
  return readFileSync(path, "utf8");
}

function json(path: string): any {
  return JSON.parse(requireFile(path));
}

function digest(path: string): string {
  return `sha256:${createHash("sha256").update(requireFile(path)).digest("hex")}`;
}

test("the Telegram conversation profile adds only the reviewed channel to the conversation contract", () => {
  const profile = json(join(profileRoot, "profile.json"));
  assert.equal(profile.metadata.id, "telegram-conversational");
  assert.deepEqual(profile.plugins, [
    { id: "conversation-agent", range: ">=0.3.0 <1.0.0" },
    { id: "telegram-channel", range: "=0.5.1" },
  ]);
  assert.deepEqual(profile.grants, ["conversation.memory", "conversation.reply"]);
  assert.deepEqual(profile.requiredHealth, ["conversation-agent.ready", "telegram-channel.ready"]);
  assert.deepEqual(profile.artifacts.skills, []);
  assert.equal(profile.state.workspace, "none");
  assert.deepEqual(profile.limits.workspaceClasses, []);
  assert.deepEqual(profile.limits.networkClasses, ["telegram-api"]);
  assert.deepEqual(profile.triggers.map((trigger: any) => trigger.class), ["message"]);
  assert.equal(profile.state.restart, "resume");
  assert.equal(profile.execution.cancellation, "cooperative");
  assert.equal(profile.execution.interrupt, "supported");
  assert.equal(profile.execution.drain, "required");
  assert.equal(profile.artifacts.inputSchemaDigest, digest(join(profileRoot, "input.schema.json")));
  assert.equal(profile.artifacts.outputSchemaDigest, digest(join(profileRoot, "output.schema.json")));
});

test("the adopted Telegram artifact identity and native DSH composition are exact and disabled", () => {
  const identity = json(join(profileRoot, "channel-plugin.lock.json"));
  assert.deepEqual(identity, {
    schemaVersion: "dsh-applications.external-plugin-lock.v1",
    package: "@ashafizullah/dsh-telegram",
    version: "0.5.1",
    tarballSha256: "sha256:a41aa5300eb0b0a25b33c162e843955eac8450c8a71446ba5c7f68623b61ea4b",
    npmIntegrity: "sha512-/bFEveB+vafAFoM2MW6vTCTPEHBMDnblAfKaFIs221Jh27cvfFrtHyhwi5vzxByqeoqMN/g/2I23+gI4NU1lLg==",
    sourceRevision: "596ef74b4fb9536aaae9981035240be4ef8a9acd",
    attestation: "https://registry.npmjs.org/-/npm/v1/attestations/@ashafizullah%2fdsh-telegram@0.5.1",
  });

  const dshManifest = json(join(profileRoot, "dsh-profile/package.json"));
  assert.deepEqual(dshManifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-headless",
  ]);
  assert.equal(dshManifest.dsh.profile.bundles.includes("@ashafizullah/dsh-telegram"), false);
  assert.equal(dshManifest.dependencies["@ashafizullah/dsh-telegram"], "0.5.1");
  assert.equal(dshManifest.dependencies["@deepseek-ai/dsh-base"], "0.1.1-rc.2");
  assert.equal(dshManifest.dependencies["@deepseek-ai/dsh-headless"], "0.1.1-rc.2");
  assert.equal(requireFile(join(profileRoot, "dsh-profile/.npmrc")), "ignore-scripts=true\n");
  const patch = requireFile(join(profileRoot, "dsh-profile/cordis.patch.yml"));
  assert.match(patch, /name: '@ashafizullah\/dsh-telegram'/u);
  assert.match(patch, /disabled: true/u);
  assert.equal((patch.match(/enabled: false/gu) ?? []).length, 4);
  assert.doesNotMatch(patch, /tokenRef|allowFrom|chat(?:Id|Ref)|senderRef/iu);
});

test("a clean native profile install consumes the reviewed locked graph without lifecycle scripts", {
  timeout: 300_000,
}, () => {
  const nativeRoot = join(profileRoot, "dsh-profile");
  const lock = json(join(nativeRoot, "package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, {
    "@ashafizullah/dsh-telegram": "0.5.1",
    "@deepseek-ai/dsh-base": "0.1.1-rc.2",
    "@deepseek-ai/dsh-headless": "0.1.1-rc.2",
  });

  const expected = new Map([
    ["@ashafizullah/dsh-telegram", {
      version: "0.5.1",
      integrity: "sha512-/bFEveB+vafAFoM2MW6vTCTPEHBMDnblAfKaFIs221Jh27cvfFrtHyhwi5vzxByqeoqMN/g/2I23+gI4NU1lLg==",
    }],
    ["@deepseek-ai/dsh-base", {
      version: "0.1.1-rc.2",
      integrity: "sha512-DT1kSaseoTZ0b8pwZ5biRkqez2K8AnsLataRiCPsn3uUuxupZOjM1e8x9W+kpkWWFykWy1mbCPhzDRVJ+pLCbg==",
    }],
    ["@deepseek-ai/dsh-headless", {
      version: "0.1.1-rc.2",
      integrity: "sha512-Pk50xwmUUehOxNe8DJ2/tThj7Aw1MmJQeUkfAQh9miF7Tm+WOOxiOOei/H4wjH9cf+FuqtbLDw6jrHmGotfhjw==",
    }],
  ]);
  for (const [name, identity] of expected) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.version, identity.version, `${name} version must remain exact`);
    assert.equal(entry.integrity, identity.integrity, `${name} integrity must remain reviewed`);
  }
  for (const [path, entry] of Object.entries(lock.packages) as Array<[string, any]>) {
    if (/(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+$/u.test(path)) {
      assert.equal(entry.version, "0.1.1-rc.2", `${path} must stay on the exact reviewed DSH line`);
    }
  }

  const installRoot = mkdtempSync(join(tmpdir(), "dsh-telegram-native-ci-"));
  try {
    cpSync(nativeRoot, installRoot, { recursive: true });
    const forbiddenScriptShell = join(installRoot, "lifecycle-script-must-not-run");
    const npmCli = process.env.DSH_APPLICATIONS_NPM_CLI ?? "npm";
    execFileSync(npmCli, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: installRoot,
      env: {
        ...process.env,
        npm_config_cache: join(installRoot, ".npm-cache"),
        npm_config_script_shell: forbiddenScriptShell,
      },
      stdio: "pipe",
      timeout: 300_000,
    });
    assert.equal(existsSync(forbiddenScriptShell), false, "npm ci must not invoke a lifecycle script shell");
    for (const [name, identity] of expected) {
      const installed = json(join(installRoot, "node_modules", name, "package.json"));
      assert.equal(installed.version, identity.version, `${name} clean-install version must match the lock`);
      for (const script of ["preinstall", "install", "postinstall"]) {
        assert.equal(installed.scripts?.[script], undefined, `${name} must not declare ${script}`);
      }
    }
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
});

test("the clean native profile composes as one disabled Telegram mount in exact DSH", {
  skip: exactDshRoot === undefined ? "DSH_ROOT is required" : false,
  timeout: 300_000,
}, () => {
  const dshHome = mkdtempSync(join(tmpdir(), "dsh-telegram-exact-profile-"));
  const installedProfile = join(dshHome, "profiles", "telegram-conversational");
  try {
    mkdirSync(installedProfile, { recursive: true });
    cpSync(join(profileRoot, "dsh-profile"), installedProfile, { recursive: true });
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: installedProfile,
      env: {
        ...process.env,
        npm_config_cache: join(dshHome, ".npm-cache"),
      },
      stdio: "pipe",
      timeout: 300_000,
    });

    const composed = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx/esm",
        join(exactDshRoot!, "apps/cli/src/bin.ts"),
        "--profile",
        "telegram-conversational",
        "--dump-config",
      ],
      {
        cwd: exactDshRoot,
        encoding: "utf8",
        env: { ...process.env, DSH_HOME: dshHome },
        timeout: 300_000,
      },
    );
    assert.equal(
      (composed.match(/name: ['"]?@ashafizullah\/dsh-telegram['"]?/gu) ?? []).length,
      1,
      "exact DSH must compose exactly one Telegram mount",
    );
    const telegramMount = composed.match(
      /- id: telegram-conversational-channel\n(?: {2,}.*(?:\n|$))*/u,
    )?.[0];
    assert.notEqual(telegramMount, undefined, "exact DSH must retain the governed Telegram mount ID");
    assert.match(telegramMount!, /disabled: true/u);
    assert.match(telegramMount!, /enabled: false/u);
    assert.match(telegramMount!, /media:\n\s+enabled: false/u);
    assert.match(telegramMount!, /ocr:\n\s+enabled: false/u);
    assert.match(telegramMount!, /screenshot:\n\s+enabled: false/u);
  } finally {
    rmSync(dshHome, { recursive: true, force: true });
  }
});

test("the Telegram descriptor declares bounded ingress mediation and no agent tools", {
  skip: !existsSync(join(exactRuntimeKitRoot, "src/composition/index.js")),
}, async () => {
  assert.equal(existsSync(join(packageRoot, "src/index.ts")), true, "Telegram descriptor source must exist");
  const runtimeKit = await import(pathToFileURL(join(exactRuntimeKitRoot, "src/composition/index.js")).href);
  const telegram = await import(pathToFileURL(join(packageRoot, "src/index.ts")).href);
  const descriptor: any = telegram.createTelegramChannelPluginDescriptor(runtimeKit);

  assert.equal(descriptor.metadata.id, "telegram-channel");
  assert.equal(descriptor.metadata.version, "0.5.1");
  assert.equal(descriptor.metadata.digest, runtimeKit.computeDocumentDigest(descriptor));
  assert.equal(descriptor.artifact.package, "@ashafizullah/dsh-telegram");
  assert.equal(descriptor.artifact.digest, "sha256:a41aa5300eb0b0a25b33c162e843955eac8450c8a71446ba5c7f68623b61ea4b");
  assert.deepEqual(descriptor.capabilities.requires, ["conversation.memory", "conversation.reply"]);
  assert.deepEqual(descriptor.capabilities.tools, []);
  assert.deepEqual(descriptor.capabilities.skills, []);
  assert.deepEqual(descriptor.actions, []);
  assert.deepEqual(descriptor.mediation.network, ["telegram-api"]);
  assert.deepEqual(descriptor.mediation.subprocess, []);
  assert.deepEqual(descriptor.mediation.credentialHandleClasses, ["telegram-bot-token"]);
  assert.deepEqual(descriptor.configuration.defaults, {
    enabled: false,
    media: { enabled: false, ocr: { enabled: false } },
    screenshot: { enabled: false },
  });
  assert.equal(
    descriptor.configuration.schemaDigest,
    digest(join(packageRoot, "schemas/public-config.schema.json")),
  );
});

test("the Telegram public surface contains no credential value, channel identifier, or host binding", () => {
  const paths = [
    join(profileRoot, "profile.json"),
    join(profileRoot, "input.schema.json"),
    join(profileRoot, "output.schema.json"),
    join(profileRoot, "channel-plugin.lock.json"),
    join(profileRoot, "dsh-profile/package.json"),
    join(profileRoot, "dsh-profile/.npmrc"),
    join(profileRoot, "dsh-profile/cordis.patch.yml"),
    join(packageRoot, "schemas/public-config.schema.json"),
  ];
  for (const path of paths) {
    const source = requireFile(path);
    assert.doesNotMatch(source, /(?:^|[^a-z])(?:chat|user|sender)[_-]?id(?:[^a-z]|$)/iu, path);
    assert.doesNotMatch(source, /tokenRef|credentialRef|secretRef|\/home\/|~\/Project\//u, path);
  }
});
