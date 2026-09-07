import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const profileRoot = resolve(root, "profiles/telegram-conversational");
const packageRoot = resolve(root, "packages/telegram-channel");
const exactRuntimeKitRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");

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
