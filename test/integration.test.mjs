import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createApplicationControlService, createApplicationManager, createPluginSandbox } from "../packages/manager/src/index.js";
import { definePlugin } from "../packages/plugin-sdk/src/index.js";
import { createOwnerRuntimeKit, hostAction, identity, pluginDescriptor } from "./helpers/owner-fixtures.mjs";

test("manager and sandbox compose runtime-kit and DSH seams without owning private deployment operations", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const dshAdapter = {
    lifecycleEffects: {},
    async executePlugin(invocation) { return invocation.hostAction(invocation.input); },
    assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "1", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"] }),
  };
  const manager = createApplicationManager({ runtimeKit, dshAdapter, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }), host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) } });
  const sandbox = createPluginSandbox({ runtimeKit, manager, dshAdapter });
  const instanceIdentity = identity();
  const action = hostAction(instanceIdentity);
  const result = await sandbox.invoke({ descriptor: pluginDescriptor(), actionId: "review.pull-request", identity: instanceIdentity, input: action });
  assert.equal(result.owner, "runtime-kit");
  assert.equal(manager.install, undefined);
  assert.equal(manager.update, undefined);
  assert.equal(manager.rollback, undefined);
  assert.equal(manager.traffic, undefined);
  assert.equal(manager.teardown, undefined);
});

const exactRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactAvailable = existsSync(join(exactRoot, "src/manager/index.js"));

test("SDK and manager construct against the exact runtime-kit owner surface", { skip: !exactAvailable }, async () => {
  const composition = await import(pathToFileURL(join(exactRoot, "src/composition/index.js")));
  const runtimeManager = await import(pathToFileURL(join(exactRoot, "src/manager/index.js")));
  const runtimeKit = { ...composition, ...runtimeManager };
  const candidate = pluginDescriptor();
  candidate.metadata.digest = composition.computeDocumentDigest(candidate);
  const descriptor = definePlugin(runtimeKit, candidate);
  assert.deepEqual(descriptor, candidate);
  assert(Object.isFrozen(descriptor));

  const dshAdapter = { lifecycleEffects: {} };
  const manager = createApplicationManager({
    runtimeKit,
    dshAdapter,
    composition: {
      validatorVersion: "1.0.0",
      resolverVersion: "1.0.0",
      resolvePublicPolicy() { return null; },
    },
    trustVerifier: { async acceptSignedDocument() { throw new Error("not exercised"); } },
    health: async () => ({ state: "ready", code: "READY" }),
  });
  assert.deepEqual(Object.keys(manager), ["validate", "resolve", "lock", "start", "resume", "status", "interrupt", "drain", "stop", "doctor"]);
  const control = createApplicationControlService({
    runtimeKit,
    manager,
    peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["public-test"] } },
    reconcileEvidence: async () => ({ status: "temporary-unavailable" }),
  });
  assert.equal(typeof control.handle, "function");
});
