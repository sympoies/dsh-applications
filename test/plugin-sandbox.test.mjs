import assert from "node:assert/strict";
import test from "node:test";

import {
  defineOutput,
  definePlugin,
  defineTrigger,
} from "../packages/plugin-sdk/src/index.js";
import {
  createApplicationManager,
  createPluginSandbox,
} from "../packages/manager/src/index.js";
import {
  createOwnerRuntimeKit,
  hostAction,
  identity,
  pluginDescriptor,
} from "./helpers/owner-fixtures.mjs";

test("typed descriptor, trigger, and output helpers are strict immutable declarations", () => {
  const runtimeKit = createOwnerRuntimeKit();
  const descriptor = definePlugin(runtimeKit, pluginDescriptor());
  assert(Object.isFrozen(descriptor));
  assert(Object.isFrozen(descriptor.actions));
  assert(runtimeKit.calls.some(call => call.operation === "validate-plugin-descriptor"));
  assert.throws(() => definePlugin(runtimeKit, { ...pluginDescriptor(), privateBinding: "forbidden" }), /unknown/i);
  assert.throws(() => defineTrigger({ id: "bad", class: "cron", privatePath: "/secret" }), /unknown/i);
  assert.throws(() => defineOutput({ id: "bad", schemaDigest: "floating" }), /digest/i);
});

function setupSandbox(executePlugin) {
  const runtimeKit = createOwnerRuntimeKit();
  const dshAdapter = {
    lifecycleEffects: {},
    executePlugin(invocation) {
      return executePlugin({ ...invocation, ambient: name => Promise.reject(new Error(`${name} denied by DSH confinement`)) });
    },
    assertPluginConfinement(subject) {
      return {
        owner: "DSH", enforced: true,
        namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "1",
        deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"],
      };
    },
  };
  const manager = createApplicationManager({
    runtimeKit, dshAdapter, composition: {}, trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
    host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) },
  });
  return {
    runtimeKit,
    sandbox: createPluginSandbox({ runtimeKit, manager, dshAdapter }),
  };
}

test("plugins receive no ambient host capabilities and every action crosses runtime-kit mediation", async () => {
  const instanceIdentity = identity();
  const { runtimeKit, sandbox } = setupSandbox(async invocation => {
    assert.deepEqual(Object.keys(invocation).sort(), ["actionId", "ambient", "descriptor", "hostAction", "identity", "input"]);
    assert.equal(invocation.process, undefined);
    assert.equal(invocation.fs, undefined);
    assert.equal(invocation.network, undefined);
    assert.equal(invocation.subprocess, undefined);
    assert.equal(invocation.credentials, undefined);
    assert.equal(invocation.clock, undefined);
    assert.equal(invocation.random, undefined);
    return invocation.hostAction(hostAction(instanceIdentity));
  });
  const result = await sandbox.invoke({ descriptor: pluginDescriptor(), actionId: "review.pull-request", identity: instanceIdentity, input: { pull: 7 } });
  assert.equal(result.kind, "MediatedHostActionSucceeded");
  assert(runtimeKit.calls.some(call => call.operation === "validate-host-request"));
  assert(runtimeKit.calls.some(call => call.owner === "host" && call.operation === "execute"));
});

test("plugin invocation fails closed unless the rc2 adapter proves enforced DSH confinement", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  for (const adapter of [
    { lifecycleEffects: {}, executePlugin: async () => null },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: () => ({ owner: "application-wrapper", enforced: true, deniedAmbient: [] }) },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: () => ({ owner: "DSH", enforced: false, deniedAmbient: [] }) },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: "other", generationId: subject.generationId, scopeRevision: "1", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"] }) },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: subject.namespace, generationId: "old-generation", scopeRevision: "1", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"] }) },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"] }) },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "1", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "provider", "clock", "random", "cross-instance"] }) },
    { lifecycleEffects: {}, executePlugin: async () => null, assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "1", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "clock", "random", "cross-instance"] }) },
  ]) {
    const manager = createApplicationManager({ runtimeKit, dshAdapter: adapter, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }), host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) } });
    if (typeof adapter.assertPluginConfinement !== "function") {
      assert.throws(() => createPluginSandbox({ runtimeKit, manager, dshAdapter: adapter }), /DSH.*adapter|sandbox/i);
    } else {
      const sandbox = createPluginSandbox({ runtimeKit, manager, dshAdapter: adapter });
      await assert.rejects(sandbox.invoke({ descriptor: pluginDescriptor(), actionId: "review.pull-request", identity: identity(), input: null }), /DSH.*confinement|sandbox/i);
    }
  }
});

test("missing/stale/wrong assertion and cross-instance or changed-action reuse fail before effects", async () => {
  const instanceIdentity = identity();
  let effects = 0;
  const { runtimeKit, sandbox } = setupSandbox(async invocation => {
    const request = hostAction(instanceIdentity, invocation.input);
    return invocation.hostAction(request);
  });
  runtimeKit.validateMediatedHostActionRequest = request => {
    if (request.runtimeAssertion?.valid !== true) throw new TypeError("assertion-invalid");
    if (request.runtimeAssertion.operation && request.runtimeAssertion.operation !== "host.action") throw new TypeError("wrong-operation");
    if (request.runtimeAssertion.requestDigest && request.runtimeAssertion.requestDigest !== request.requestDigest) throw new TypeError("wrong-request");
    if (request.runtimeAssertion.pluginId !== request.pluginId) throw new TypeError("wrong-plugin");
    if (request.runtimeAssertion.instanceId !== request.identity.instanceId) throw new TypeError("wrong-instance");
    if (request.runtimeAssertion.targetScopeDigest !== request.targetScopeDigest) throw new TypeError("wrong-target");
    if (request.runtimeAssertion.resourceClass !== request.resourceClass) throw new TypeError("wrong-resource");
    if (BigInt(request.runtimeAssertion.budgetUnits) < BigInt(request.budgetDebit.units)) throw new TypeError("over-budget");
    if (request.runtimeAssertion.publisherEpoch !== request.publisherEpoch) throw new TypeError("wrong-epoch");
    if (request.runtimeAssertion.expectedState !== request.expectedState) throw new TypeError("wrong-state");
    effects += 1;
    return request;
  };
  for (const candidate of [
    { runtimeAssertion: null },
    { runtimeAssertion: { valid: false } },
    { runtimeAssertion: { valid: true, operation: "instance.start" } },
    { runtimeAssertion: { valid: true, requestDigest: "different" } },
    { identity: identity("other") },
    { pluginId: "other" },
    { actionId: "other" },
    { pluginDescriptorDigest: "other" },
    { inputSchemaDigest: "other" },
    { outputSchemaDigest: "other" },
    { runtimeAssertion: { ...hostAction(instanceIdentity).runtimeAssertion, pluginId: "other" } },
    { runtimeAssertion: { ...hostAction(instanceIdentity).runtimeAssertion, instanceId: "other" } },
    { runtimeAssertion: { ...hostAction(instanceIdentity).runtimeAssertion, targetScopeDigest: "other" } },
    { runtimeAssertion: { ...hostAction(instanceIdentity).runtimeAssertion, resourceClass: "other" } },
    { budgetDebit: { units: "2" } },
    { publisherEpoch: "2" },
    { expectedState: "Draining" },
  ]) {
    await assert.rejects(
      sandbox.invoke({ descriptor: pluginDescriptor(), actionId: "review.pull-request", identity: instanceIdentity, input: candidate }),
      /assertion|identity|instance|plugin|action|operation|request|target|resource|budget|epoch|state/i,
    );
  }
  assert.equal(effects, 0);
});

test("DSH confinement denies every ambient class and cross-instance escape", async () => {
  const denied = ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"];
  const instanceIdentity = identity();
  const { sandbox } = setupSandbox(async invocation => {
    for (const ambient of denied) {
      await assert.rejects(invocation.ambient(ambient), new RegExp(ambient));
    }
    return { denied };
  });
  const result = await sandbox.invoke({ descriptor: pluginDescriptor(), actionId: "review.pull-request", identity: instanceIdentity, input: null });
  assert.deepEqual(result.denied, denied);
});

test("exact action retry is idempotent while changed reuse and Indeterminate redispatch remain owner failures", async () => {
  const instanceIdentity = identity();
  const rows = new Map();
  let effects = 0;
  const runtimeKit = createOwnerRuntimeKit({
    host(request) {
      const previous = rows.get(request.idempotencyKey);
      if (previous && previous.requestDigest !== request.requestDigest) return { kind: "MediatedHostActionFailed", code: "idempotency-conflict" };
      if (previous) return previous;
      effects += 1;
      const result = request.indeterminate
        ? { kind: "MediatedHostActionIndeterminate", code: "external-effect-unknown" }
        : { kind: "MediatedHostActionSucceeded" };
      rows.set(request.idempotencyKey, { ...result, requestDigest: request.requestDigest });
      return rows.get(request.idempotencyKey);
    },
  });
  const dshAdapter = {
    lifecycleEffects: {}, async executePlugin(invocation) { return invocation.hostAction(invocation.input); },
    assertPluginConfinement: subject => ({ owner: "DSH", enforced: true, namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "1", deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"] }),
  };
  const manager = createApplicationManager({ runtimeKit, dshAdapter, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }), host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) } });
  const sandbox = createPluginSandbox({ runtimeKit, manager, dshAdapter });
  const exact = hostAction(instanceIdentity);
  const invocation = { descriptor: pluginDescriptor(), actionId: "review.pull-request", identity: instanceIdentity, input: exact };
  await sandbox.invoke(invocation);
  await sandbox.invoke(invocation);
  assert.equal(effects, 1);
  const changed = hostAction(instanceIdentity, { requestDigest: "changed" });
  assert.equal((await sandbox.invoke({ ...invocation, input: changed })).code, "idempotency-conflict");
  const unknown = hostAction(instanceIdentity, { idempotencyKey: "unknown", requestDigest: "unknown", indeterminate: true });
  assert.equal((await sandbox.invoke({ ...invocation, input: unknown })).kind, "MediatedHostActionIndeterminate");
  assert.equal((await sandbox.invoke({ ...invocation, input: unknown })).kind, "MediatedHostActionIndeterminate");
  assert.equal(effects, 2);
});
