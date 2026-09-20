import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createCodexSubscriptionProviderDescriptor } from "../packages/codex-subscription-provider/src/index.ts";
import { createOwnerRuntimeKit, DIGEST } from "./helpers/owner-fixtures.ts";

const root = resolve(import.meta.dirname, "..");
const profileIds = [
  "batch",
  "coding",
  "conversational",
  "github-pr-review",
  "telegram-assistant",
  "telegram-conversational",
];

function json(path: string) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

test("the reviewed Codex subscription artifact is fixed and composable", () => {
  const descriptor = createCodexSubscriptionProviderDescriptor({
    ...createOwnerRuntimeKit(),
    computeDocumentDigest: () => DIGEST,
  }) as any;

  assert.equal(descriptor.metadata.id, "llm-codex-subscription");
  assert.equal(descriptor.metadata.version, "0.1.4");
  assert.deepEqual(descriptor.artifact, {
    package: "@sympoies/dsh-llm-codex-subscription",
    digest: "sha256:60a2a41b61f0d72420082e10ff0ba9b6048a2f52238bbfdeaa1a8031f4b5c3fe",
    entrypoint: "lib/index.js",
    sourceRevision: "c51ebcf6b351675fd9ef8ef9a88e3bd7742fcb58",
    attestationIdentity: "https://github.com/sympoies/dsh-plugins/.github/workflows/release.yml@refs/tags/dsh-llm-codex-subscription-v0.1.4",
  });
  assert.equal(descriptor.configuration.defaults.route, "codex-subscription");
  assert.equal(
    descriptor.configuration.schemaDigest,
    `sha256:${createHash("sha256").update(readFileSync(resolve(root, "packages/codex-subscription-provider/schemas/public-config.schema.json"))).digest("hex")}`,
  );
  assert.deepEqual(descriptor.mediation.network, ["codex-subscription-provider"]);
  assert.equal(descriptor.compatibility.dsh, "=0.1.6-alpha.2");
});

test("every model-using public profile requires the Codex subscription adapter", () => {
  for (const id of profileIds) {
    const profile = json(`profiles/${id}/profile.json`);
    assert.deepEqual(
      profile.plugins.find((plugin: any) => plugin.id === "llm-codex-subscription"),
      { id: "llm-codex-subscription", range: "=0.1.4" },
      `${id} must require the reviewed provider plugin`,
    );
    assert(profile.requiredHealth.includes("llm-codex-subscription.ready"));
    assert(profile.limits.networkClasses.includes("codex-subscription-provider"));
  }
});
