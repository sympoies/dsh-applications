import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { defineTrigger } from "../packages/plugin-sdk/src/index.js";

const root = resolve(import.meta.dirname, "..");
const profileIds = ["batch", "coding", "conversational", "github-pr-review"];
const fixtureIds = ["channel", "github-event", "manual", "schedule"];

function json(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch {
    return {};
  }
}

function profile(id) {
  return json(`profiles/${id}/profile.json`);
}

function fixture(id) {
  return json(`fixtures/triggers/${id}.json`);
}

function authority(profileDocument) {
  return {
    workload: profileDocument.workload,
    plugins: profileDocument.plugins,
    grants: profileDocument.grants,
    approvals: profileDocument.approvals,
    limits: profileDocument.limits,
    state: profileDocument.state,
    execution: profileDocument.execution,
  };
}

function visit(value, callback, path = "$") {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child, `${path}.${key}`);
    visit(child, callback, `${path}.${key}`);
  }
}

test("the catalog declares four distinct least-authority profiles", () => {
  const profiles = Object.fromEntries(profileIds.map(id => [id, profile(id)]));
  assert.deepEqual(Object.keys(profiles).sort(), profileIds);
  assert.deepEqual(profiles.coding.workload, {
    class: "interactive-coding",
    scopeClass: "project",
  });
  assert.deepEqual(profiles.coding.grants, [
    "coding.repository.read",
    "coding.repository.write",
    "coding.shell",
    "coding.workspace",
  ]);
  assert.deepEqual(profiles.conversational.workload, {
    class: "conversational-service",
    scopeClass: "non-project",
  });
  assert.deepEqual(profiles.conversational.grants, [
    "conversation.memory",
    "conversation.reply",
  ]);
  assert.deepEqual(profiles["github-pr-review"].workload, {
    class: "event-service",
    scopeClass: "non-project",
  });
  assert.deepEqual(profiles["github-pr-review"].grants, [
    "github.pull-request.read",
    "github.review.publish",
  ]);
  assert.deepEqual(profiles.batch.workload, {
    class: "batch",
    scopeClass: "non-project",
  });
  assert.deepEqual(profiles.batch.grants, ["batch.input.read", "batch.output.write"]);

  for (const id of ["conversational", "github-pr-review", "batch"]) {
    assert.equal(profiles[id].state?.workspace, "none", `${id} has no project workspace`);
    assert.deepEqual(profiles[id].limits?.workspaceClasses, [], `${id} has no workspace class`);
    assert(!profiles[id].grants?.some(grant => grant.startsWith("coding.")), `${id} has no coding grant`);
  }
  assert.equal(new Set(Object.values(profiles).map(value => JSON.stringify(authority(value)))).size, 4);
});

test("public profiles and fixtures contain no private deployment state", () => {
  const documents = [
    ...profileIds.map(profile),
    ...fixtureIds.map(fixture),
    json("profiles/catalog.json"),
    json("compatibility/dsh-applications-lock.json"),
  ];
  const forbiddenKeys = new Set([
    "channelid", "credentialhandle", "deploymentid", "environment", "generationid",
    "hostidentity", "installationid", "instanceid", "privatebinding", "repositoryid",
    "runtimeroot", "secretlocator", "serviceidentity", "trafficstate",
  ]);
  for (const id of profileIds) {
    assert.equal(profile(id).metadata?.id, id, `${id} must exist before its public-state boundary can be checked`);
  }
  for (const id of fixtureIds) {
    assert.equal(fixture(id).id, id, `${id} must exist before its public-state boundary can be checked`);
  }
  for (const document of documents) {
    visit(document, (key, value, path) => {
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
      assert(!forbiddenKeys.has(normalized), `${path} is private deployment state`);
      if (typeof value === "string") {
        assert.doesNotMatch(value, /(?:^|\s)(?:\/home\/|~\/Project\/)/u, `${path} is machine-local`);
      }
    });
  }
});

test("trigger fixtures are reusable configuration and cannot widen profile authority", () => {
  const expected = {
    channel: ["channel", "message"],
    "github-event": ["event", "webhook"],
    manual: ["manual", "manual"],
    schedule: ["schedule", "schedule"],
  };
  for (const [id, [descriptorClass, profileClass]] of Object.entries(expected)) {
    const document = fixture(id);
    assert.equal(document.apiVersion, "applications.sympoies.dev/v1");
    assert.equal(document.kind, "TriggerFixture");
    assert.equal(document.id, id);
    assert.equal(document.profileClass, profileClass);
    assert.equal(defineTrigger(document.descriptor).class, descriptorClass);
    for (const forbidden of ["grants", "approvals", "limits", "plugins", "workspace", "credentials"] ) {
      assert(!(forbidden in document), `${id} fixture cannot declare ${forbidden}`);
    }
  }

  assert.deepEqual(profile("coding").triggers?.map(item => item.class), ["manual"]);
  assert.deepEqual(profile("conversational").triggers?.map(item => item.class), ["message"]);
  assert.deepEqual(profile("github-pr-review").triggers?.map(item => item.class), ["webhook"]);
  assert.deepEqual(profile("batch").triggers?.map(item => item.class), ["manual", "schedule"]);
});

test("manual and scheduled batch invocation preserve one authority document", () => {
  const batch = profile("batch");
  const bindings = batch.triggers?.map(trigger => ({
    trigger,
    authority: authority(batch),
  })) ?? [];
  assert.equal(bindings.length, 2);
  assert.deepEqual(bindings.map(binding => binding.trigger.class), ["manual", "schedule"]);
  assert.deepEqual(bindings[0].authority, bindings[1].authority);
  assert.equal(bindings[0].trigger.inputSchemaDigest, bindings[1].trigger.inputSchemaDigest);
});

test("the compatibility manifest binds the coordinated catalog version and profile digests", () => {
  const workspace = json("package.json");
  const catalog = json("profiles/catalog.json");
  const lock = json("compatibility/dsh-applications-lock.json");
  assert.equal(workspace.version, "0.2.1");
  assert.equal(catalog.version, workspace.version);
  assert.equal(lock.application_version, workspace.version);
  assert.equal(lock.profile_catalog.path, "profiles/catalog.json");
  assert.match(lock.profile_catalog.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(
    catalog.profiles.map(item => item.id),
    profileIds,
  );
  for (const entry of catalog.profiles) {
    const document = profile(entry.id);
    assert.equal(entry.path, `profiles/${entry.id}/profile.json`);
    assert.equal(entry.digest, document.metadata?.digest);
  }
  const reviewOutput = json("profiles/github-pr-review/output.schema.json");
  assert.deepEqual(reviewOutput.required, ["decision", "reviewReport", "inlineComments"]);
  assert.equal(reviewOutput.properties?.reviewReport?.properties?.format?.const, "agent-kit.specialist-review-report.v1");
  assert.equal(reviewOutput.properties?.inlineComments?.maxItems, 50);
  assert.equal(reviewOutput.properties?.inlineComments?.items?.properties?.line?.minimum, 1);
});
