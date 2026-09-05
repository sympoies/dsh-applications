import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGitHubReadPluginDescriptor, type RuntimeKitPluginDescriptorOwner } from "../packages/github-read/src/index.ts";
import { createGitHubReviewPublishPluginDescriptor } from "../packages/github-review-publish/src/index.ts";
import { defineTrigger, type TriggerDescriptor } from "../packages/plugin-sdk/src/index.ts";

const root = resolve(import.meta.dirname, "..");

function load(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function digestFile(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function parseArguments(argv: string[]) {
  if (argv.length !== 2 || argv[0] !== "--runtime-kit-root") {
    throw new Error("provide --runtime-kit-root PATH");
  }
  return resolve(argv[1]!);
}

function assertPublicPath(path: string, expectedPrefix: string) {
  assert.equal(typeof path, "string");
  assert(path.startsWith(expectedPrefix));
  assert(!path.startsWith("/"));
  assert(!path.split("/").some((segment: string) => segment === "" || segment === "." || segment === ".."));
  assert.equal(statSync(resolve(root, path)).isFile(), true, `${path} must exist`);
}

const runtimeKitRoot = parseArguments(process.argv.slice(2));
const lock = load(resolve(root, "compatibility/dsh-applications-lock.json"));
const workspace = load(resolve(root, "package.json"));
const catalogPath = resolve(root, lock.profile_catalog.path);
const catalog = load(catalogPath);

assert.equal(
  execFileSync("git", ["-C", runtimeKitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  lock.runtime_kit.revision,
  "runtime-kit checkout must equal the compatibility lock",
);
assert.equal(workspace.version, lock.application_version);
assert.equal(catalog.version, workspace.version);
assert.equal(catalog.runtimeKitRevision, lock.runtime_kit.revision);
assert.equal(digestFile(catalogPath), lock.profile_catalog.digest);

const runtimePackage = load(resolve(runtimeKitRoot, "package.json"));
type ExternalComposition = RuntimeKitPluginDescriptorOwner & {
  computeCatalogSnapshotDigest(value: unknown): string;
  computePublicPolicyDigest(value: unknown): string;
  parseCanonicalJsonText(value: string): any;
  resolveComposition(value: unknown): any;
  validateBotProfile(value: unknown): unknown;
  versionSatisfies(version: string, range: string): boolean;
  readonly [method: string]: unknown;
};
const composition = await import(
  pathToFileURL(resolve(runtimeKitRoot, runtimePackage.exports["./composition"])).href
) as ExternalComposition;
for (const method of [
  "computeCatalogSnapshotDigest", "computeDocumentDigest", "computePublicPolicyDigest",
  "parseCanonicalJsonText", "resolveComposition", "validateBotProfile", "versionSatisfies",
]) {
  assert.equal(typeof composition[method], "function", `runtime-kit composition.${method} is required`);
}

const profileIds = catalog.profiles.map((entry: { id: string }) => entry.id);
assert.deepEqual(profileIds, [...new Set(profileIds)].sort());
for (const entry of catalog.profiles as Array<{ id: string; path: string; digest: string }>) {
  assert.equal(entry.path, `profiles/${entry.id}/profile.json`);
  assertPublicPath(entry.path, "profiles/");
  const profile = composition.parseCanonicalJsonText(readFileSync(resolve(root, entry.path), "utf8"));
  assert.equal(composition.validateBotProfile(profile), profile);
  assert.equal(composition.computeDocumentDigest(profile), entry.digest);
  assert.equal(profile.metadata.digest, entry.digest);
  assert.equal(profile.metadata.version, catalog.version);
  assertPublicPath(profile.artifacts.instructions, `profiles/${entry.id}/`);
  assert.equal(digestFile(resolve(root, `profiles/${entry.id}/input.schema.json`)), profile.artifacts.inputSchemaDigest);
  assert.equal(digestFile(resolve(root, `profiles/${entry.id}/output.schema.json`)), profile.artifacts.outputSchemaDigest);
}

const reviewProfile = load(resolve(root, "profiles/github-pr-review/profile.json"));
const reviewPublisherRange = reviewProfile.plugins.find((plugin: { id: string; range: string }) => plugin.id === "github-review-publish")?.range;
assert.equal(reviewPublisherRange, ">=0.3.0 <1.0.0");
assert.equal(
  composition.versionSatisfies("0.2.999", reviewPublisherRange),
  false,
  "the v0.3 review profile must reject every v0.2 publisher",
);
const reviewArtifact = {
  digest: `sha256:${"4".repeat(64)}` as `sha256:${string}`,
  sourceRevision: "3".repeat(40),
  attestationIdentity: `https://github.com/sympoies/dsh-applications/actions@${"3".repeat(40)}`,
};
const reviewPlugins = [
  createGitHubReadPluginDescriptor(composition, reviewArtifact),
  createGitHubReviewPublishPluginDescriptor(composition, reviewArtifact),
];
const reviewPublisher = reviewPlugins.find(plugin => plugin.metadata.id === "github-review-publish");
assert(reviewPublisher, "the actual github-review-publish descriptor is required");
assert.equal(reviewPublisher.metadata.version, "0.3.0");
assert.equal(composition.versionSatisfies(reviewPublisher.metadata.version, reviewPublisherRange), true);
const reviewPolicy = {
  digest: `sha256:${"0".repeat(64)}`,
  grants: [...reviewProfile.grants],
  networkClasses: [],
  workspaceClasses: [],
  resourceClasses: ["shared"],
};
reviewPolicy.digest = composition.computePublicPolicyDigest(reviewPolicy);
const resolvedReview = composition.resolveComposition({
  profile: reviewProfile,
  plugins: reviewPlugins,
  runtime: {
    dshVersion: lock.dsh.version,
    runtimeKitVersion: "0.0.0",
    pluginApiVersion: "1.0.0",
    platform: "linux-x64",
    resolverVersion: "1.0.0",
  },
  publicPolicy: reviewPolicy,
  catalogSnapshotDigest: composition.computeCatalogSnapshotDigest(reviewPlugins),
  reason: "initial",
});
assert.deepEqual(
  resolvedReview.composition.plugins.map((plugin: { id: string; version: string }) => [plugin.id, plugin.version]),
  [["github-read", "0.3.0"], ["github-review-publish", "0.3.0"]],
);

const triggerMappings = new Map<string, string>();
for (const entry of catalog.triggerFixtures as Array<{ id: string; path: string }>) {
  assert.equal(entry.path, `fixtures/triggers/${entry.id}.json`);
  assertPublicPath(entry.path, "fixtures/triggers/");
  const fixture = load(resolve(root, entry.path));
  assert.equal(fixture.id, entry.id);
  defineTrigger(fixture.descriptor as TriggerDescriptor);
  assertPublicPath(fixture.schema, "fixtures/triggers/schemas/");
  assert.equal(digestFile(resolve(root, fixture.schema)), fixture.descriptor.inputSchemaDigest);
  assert(!triggerMappings.has(fixture.profileClass));
  triggerMappings.set(fixture.profileClass, entry.id);
}
assert.deepEqual([...triggerMappings.keys()].sort(), ["manual", "message", "schedule", "webhook"]);
for (const entry of catalog.profiles as Array<{ path: string }>) {
  const profile = load(resolve(root, entry.path));
  for (const trigger of profile.triggers) assert(triggerMappings.has(trigger.class));
}

for (const relative of [
  "packages/plugin-sdk/package.json",
  "packages/manager/package.json",
  "packages/dsh-rc2-adapter/package.json",
  "packages/github-read/package.json",
  "packages/github-review-publish/package.json",
  "packages/conversation-agent/package.json",
]) {
  assert.equal(load(resolve(root, relative)).version, workspace.version, `${relative} must share the release version`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: catalog.version,
  runtime_kit_revision: lock.runtime_kit.revision,
  profiles: profileIds,
  trigger_fixtures: catalog.triggerFixtures.map((entry: { id: string }) => entry.id),
})}\n`);
