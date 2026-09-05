import assert from "node:assert/strict";
import test from "node:test";

import * as pluginSdk from "../packages/plugin-sdk/src/index.ts";
import * as managerApi from "../packages/manager/src/index.ts";
import {
  DIGEST,
  admitRunningPlugin,
  createOwnerRuntimeKit,
  hostAction,
  identity,
  pluginDescriptor,
} from "./helpers/owner-fixtures.ts";

const pluginSdkRuntime: any = pluginSdk;
const { defineOutput, definePlugin, defineTrigger } = pluginSdkRuntime;
const { createApplicationManager, createPluginSandbox } = managerApi as any;

test("SDK exports strict immutable plugin, trigger, output, configuration, health, and sandbox helpers", () => {
  const runtimeKit = createOwnerRuntimeKit();
  const descriptor = definePlugin(runtimeKit, pluginDescriptor());
  const trigger = defineTrigger({ id: "manual.review", class: "manual", inputSchemaDigest: DIGEST });
  const output = defineOutput({ id: "review.result", schemaDigest: DIGEST });
  const configuration = pluginSdkRuntime.defineConfiguration({ schemaDigest: DIGEST, defaults: { mode: "safe" } });
  const health = pluginSdkRuntime.defineHealth({ probes: [{ id: "review.ready", requirement: "required" }] });
  const sandbox = pluginSdkRuntime.defineSandbox({
    filesystem: [], network: ["github-api"], subprocess: [], credentialHandleClasses: [],
    resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
  });
  for (const declaration of [descriptor, trigger, output, configuration, health, sandbox]) {
    assert(Object.isFrozen(declaration));
  }
  assert(Object.isFrozen(configuration.defaults));
  assert(Object.isFrozen(health.probes));
  assert(Object.isFrozen(sandbox.resources));
  assert(runtimeKit.calls.some(call => call.operation === "validate-plugin-descriptor"));
  assert.throws(() => definePlugin(runtimeKit, { ...pluginDescriptor(), privateBinding: "forbidden" }), /unknown/i);
  assert.throws(() => defineTrigger({ id: "bad", class: "cron", privatePath: "/private" }), /unknown/i);
  assert.throws(() => defineOutput({ id: "bad", schemaDigest: "floating" }), /digest/i);
  assert.throws(() => pluginSdkRuntime.defineConfiguration({ schemaDigest: DIGEST, defaults: {}, privateBinding: true }), /unknown/i);
  const sparseDefaults = [];
  sparseDefaults[1] = true;
  for (const defaults of [undefined, Number.NaN, -0, { value: undefined }, sparseDefaults]) {
    assert.throws(
      () => pluginSdkRuntime.defineConfiguration({ schemaDigest: DIGEST, defaults }),
      /JSON/i,
    );
  }
  assert.throws(() => pluginSdkRuntime.defineHealth({ probes: [{ id: "review.ready", requirement: "best-effort" }] }), /unsupported/i);
  assert.throws(() => pluginSdkRuntime.defineSandbox({ ...sandbox, network: ["z", "a"] }), /sorted/i);
});

function setupSandbox(executePlugin: any, options: any = {}) {
  const runtimeKit = options.runtimeKit ?? createOwnerRuntimeKit();
  const instanceIdentity = options.identity ?? identity();
  const descriptor = options.descriptor ?? pluginDescriptor();
  const dshAdapter = {
    lifecycleEffects: {},
    executePlugin,
  };
  const manager = createApplicationManager({
    runtimeKit,
    runtimeStore: runtimeKit.store,
    dshAdapter,
    composition: {},
    trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
    host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) },
  });
  const admission = admitRunningPlugin(runtimeKit, instanceIdentity, descriptor);
  const admissionResolver = options.admissionResolver ?? admission.admissionResolver;
  const schemaOwner = options.schemaOwner ?? admission.schemaOwner;
  return {
    runtimeKit,
    manager,
    dshAdapter,
    instanceIdentity,
    sandbox: createPluginSandbox({
      runtimeKit,
      manager,
      dshAdapter,
      admissionResolver,
      schemaOwner,
      payloadLimits: options.payloadLimits,
    }),
  };
}

function invokeRequest(instanceIdentity: any, input: any, overrides: any = {}) {
  return {
    pluginId: "review",
    actionId: "review.pull-request",
    identity: instanceIdentity,
    input,
    ...overrides,
  };
}

test("locked plugin execution receives no ambient manager capability and every mediated class crosses runtime-kit", async () => {
  // Effectful classes may only ride a write-declared action; the sandbox
  // refuses them for a read-declared action before any host execution.
  const readClasses = ["filesystem-read", "provider-read", "clock-read", "random-read"];
  const effectfulClasses = [
    "filesystem-write", "network-connect", "subprocess-template",
    "credential-use", "provider-write",
  ];
  const executePlugin = async invocation => {
    assert.deepEqual(Object.keys(invocation).sort(), ["actionId", "descriptor", "hostAction", "identity", "input"]);
    for (const ambient of ["process", "fs", "network", "subprocess", "credentials", "provider", "clock", "random"]) {
      assert.equal(invocation[ambient], undefined);
    }
    return invocation.hostAction(invocation.input);
  };
  const instanceIdentity = identity();
  const { runtimeKit, sandbox } = setupSandbox(executePlugin);
  for (const actionClass of readClasses) {
    const result = await sandbox.invoke(invokeRequest(
      instanceIdentity,
      hostAction(instanceIdentity, { actionClass, requestId: `request-${actionClass}` }),
    ));
    assert.equal(result.kind, "MediatedHostActionSucceeded");
  }
  for (const actionClass of effectfulClasses) {
    await assert.rejects(
      sandbox.invoke(invokeRequest(
        instanceIdentity,
        hostAction(instanceIdentity, { actionClass, requestId: `request-${actionClass}` }),
      )),
      /escalates past the declared read action/u,
      actionClass,
    );
  }
  assert.equal(runtimeKit.calls.filter(call => call.operation === "validate-host-request").length, readClasses.length);
  assert.equal(runtimeKit.calls.filter(call => call.owner === "host" && call.operation === "execute").length, readClasses.length);

  const writeDescriptor = pluginDescriptor();
  writeDescriptor.actions[0].class = "write";
  writeDescriptor.actions[0].sideEffect = "idempotent";
  const writeIdentity = identity("instance-write");
  const writeSandbox = setupSandbox(executePlugin, { descriptor: writeDescriptor, identity: writeIdentity });
  for (const actionClass of effectfulClasses) {
    const result = await writeSandbox.sandbox.invoke(invokeRequest(
      writeIdentity,
      hostAction(writeIdentity, { actionClass, requestId: `write-request-${actionClass}` }),
    ));
    assert.equal(result.kind, "MediatedHostActionSucceeded");
  }
  assert.equal(
    writeSandbox.runtimeKit.calls.filter(call => call.owner === "host" && call.operation === "execute").length,
    effectfulClasses.length,
  );
});

test("caller descriptors and substituted admission proofs fail before DSH execution", async () => {
  let executions = 0;
  const instanceIdentity = identity();
  const descriptor = pluginDescriptor();
  const base = setupSandbox(async () => { executions += 1; return {}; }, { identity: instanceIdentity, descriptor });
  await assert.rejects(base.sandbox.invoke({
    ...invokeRequest(instanceIdentity, {}), descriptor,
  }), /fields/i);
  for (const mutate of [
    resolution => { resolution.descriptorDigest = `sha256:${"2".repeat(64)}`; },
    resolution => { resolution.artifactDigest = `sha256:${"2".repeat(64)}`; },
    resolution => { resolution.resolvedCompositionDigest = `sha256:${"2".repeat(64)}`; },
    resolution => { resolution.compositionLockReceiptDigest = `sha256:${"2".repeat(64)}`; },
    resolution => { resolution.admissionSealDigest = `sha256:${"2".repeat(64)}`; },
    resolution => { resolution.descriptor = pluginDescriptor("other"); },
  ]) {
    const admission = admitRunningPlugin(base.runtimeKit, instanceIdentity, descriptor);
    const subject = createPluginSandbox({
      runtimeKit: base.runtimeKit,
      manager: base.manager,
      dshAdapter: base.dshAdapter,
      schemaOwner: admission.schemaOwner,
      admissionResolver(query) {
        const resolution = structuredClone(admission.admissionResolver(query));
        mutate(resolution);
        return resolution;
      },
    });
    await assert.rejects(subject.invoke(invokeRequest(instanceIdentity, {})), /admission|descriptor|plugin/i);
  }
  assert.equal(executions, 0);
});

test("input schema, secret, byte, depth, item, accessor, and clone bounds fail before DSH execution", async () => {
  let executions = 0;
  const { sandbox, instanceIdentity } = setupSandbox(async invocation => {
    executions += 1;
    return invocation.input;
  }, {
    payloadLimits: { inputBytes: 128, outputBytes: 128, depth: 3, items: 4 },
  });
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get() { throw new Error("getter must not run"); } });
  const candidates = [
    { schemaInvalid: true },
    { apiToken: "not-a-token" },
    { text: "x".repeat(129) },
    { a: { b: { c: { d: true } } } },
    { a: 1, b: 2, c: 3, d: 4, e: 5 },
    { value: -0 },
    accessor,
  ];
  for (const candidate of candidates) {
    await assert.rejects(
      sandbox.invoke(invokeRequest(instanceIdentity, candidate)),
      /schema|secret|byte|depth|item|data field|JSON/i,
    );
  }
  assert.equal(executions, 0);
});

test("a huge sparse array is rejected before length-proportional construction", async () => {
  let executions = 0;
  let amplified = false;
  const { sandbox, instanceIdentity } = setupSandbox(async invocation => {
    executions += 1;
    return invocation.input;
  }, {
    payloadLimits: { inputBytes: 128, outputBytes: 128, depth: 3, items: 4 },
  });
  const sparse = [];
  sparse.length = 2 ** 32 - 1;
  const originalArrayFrom = Array.from;
  Array.from = function guardedArrayFrom(value, ...rest) {
    if (Number.isSafeInteger(value?.length) && value.length > 1_000) {
      amplified = true;
      throw new Error("length-proportional construction attempted");
    }
    return originalArrayFrom.call(Array, value, ...rest);
  };
  try {
    await assert.rejects(
      sandbox.invoke(invokeRequest(instanceIdentity, sparse)),
      /item limit/i,
    );
  } finally {
    Array.from = originalArrayFrom;
  }
  assert.equal(amplified, false);
  assert.equal(executions, 0);
});

test("plugin invocation bytes are snapshotted before asynchronous admission", async () => {
  const gate = Promise.withResolvers<void>();
  const runtimeKit = createOwnerRuntimeKit();
  const instanceIdentity = identity();
  const admission = admitRunningPlugin(runtimeKit, instanceIdentity);
  const subject = setupSandbox(async invocation => invocation.input, {
    runtimeKit,
    identity: instanceIdentity,
    admissionResolver: async query => {
      await gate.promise;
      return admission.admissionResolver(query);
    },
  });
  const request = invokeRequest(instanceIdentity, { revision: "original" });
  const pending = subject.sandbox.invoke(request);
  request.input = { revision: "substituted" };
  gate.resolve();
  assert.deepEqual(await pending, { revision: "original" });
});

test("admission is revalidated against the current running instance after asynchronous resolution", async () => {
  const gate = Promise.withResolvers<void>();
  let executions = 0;
  const runtimeKit = createOwnerRuntimeKit();
  const instanceIdentity = identity();
  const admission = admitRunningPlugin(runtimeKit, instanceIdentity);
  const subject = setupSandbox(async () => { executions += 1; return {}; }, {
    runtimeKit,
    identity: instanceIdentity,
    admissionResolver: async query => {
      await gate.promise;
      return admission.admissionResolver(query);
    },
  });
  const pending = subject.sandbox.invoke(invokeRequest(instanceIdentity, {}));
  runtimeKit.store.instances.get(instanceIdentity.namespace).state = "Stopped";
  gate.resolve();
  await assert.rejects(pending, /running/i);
  assert.equal(executions, 0);
});

test("admission cannot cross a complete lifecycle receipt epoch", async () => {
  const gate = Promise.withResolvers<void>();
  let executions = 0;
  const runtimeKit = createOwnerRuntimeKit();
  const instanceIdentity = identity();
  const admission = admitRunningPlugin(runtimeKit, instanceIdentity);
  const subject = setupSandbox(async () => { executions += 1; return {}; }, {
    runtimeKit,
    identity: instanceIdentity,
    admissionResolver: async query => {
      await gate.promise;
      return admission.admissionResolver(query);
    },
  });
  const pending = subject.sandbox.invoke(invokeRequest(instanceIdentity, {}));
  const instance = runtimeKit.store.instances.get(instanceIdentity.namespace);
  instance.state = "Stopped";
  instance.receiptHead = `sha256:${"2".repeat(64)}`;
  instance.state = "Running";
  gate.resolve();
  await assert.rejects(pending, /lifecycle|receipt|epoch|changed/i);
  assert.equal(executions, 0);
});

test("mediated host effects receive a detached request snapshot", async () => {
  const gate = Promise.withResolvers<void>();
  const effects = [];
  const instanceIdentity = identity();
  const runtimeKit = createOwnerRuntimeKit({
    async host(request) {
      await gate.promise;
      effects.push(structuredClone(request));
      return request;
    },
  });
  const { sandbox } = setupSandbox(async invocation => {
    const request = hostAction(instanceIdentity, { payload: { revision: "original" } });
    const pending = invocation.hostAction(request);
    request.payload.revision = "mutated";
    gate.resolve();
    return pending;
  }, { runtimeKit, identity: instanceIdentity });
  const result = await sandbox.invoke(invokeRequest(instanceIdentity, {}));
  assert.equal(effects[0].payload.revision, "original");
  assert.equal(result.payload.revision, "original");
});

test("a retained mediated-host capability is revoked when plugin execution settles", async () => {
  const instanceIdentity = identity();
  let retainedHostAction;
  let effects = 0;
  const runtimeKit = createOwnerRuntimeKit({
    host(request) { effects += 1; return request; },
  });
  const { sandbox } = setupSandbox(async invocation => {
    retainedHostAction = invocation.hostAction;
    return { completed: true };
  }, { runtimeKit, identity: instanceIdentity });
  assert.deepEqual(await sandbox.invoke(invokeRequest(instanceIdentity, {})), { completed: true });
  await assert.rejects(retainedHostAction(hostAction(instanceIdentity)), /active|revoked|settled/i);
  assert.equal(effects, 0);
});

test("output schema, descriptor byte ceiling, and secret-shaped material fail before release", async () => {
  const outputs = [
    { schemaInvalid: true },
    { accessToken: "not-a-token" },
    { text: "x".repeat(70_000) },
  ];
  for (const output of outputs) {
    const { sandbox, instanceIdentity } = setupSandbox(async () => output);
    await assert.rejects(
      sandbox.invoke(invokeRequest(instanceIdentity, {})),
      /schema|secret|byte/i,
    );
  }
});

test("missing, stale, wrong, cross-instance, and changed-action assertions fail before host effects", async () => {
  const instanceIdentity = identity();
  let effects = 0;
  const { runtimeKit, sandbox } = setupSandbox(async invocation => invocation.hostAction(
    hostAction(instanceIdentity, invocation.input),
  ));
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
      sandbox.invoke(invokeRequest(instanceIdentity, candidate)),
      /assertion|identity|instance|plugin|action|operation|request|target|resource|budget|epoch|state/i,
    );
  }
  assert.equal(effects, 0);
});

test("a canonical alias cannot select another instance admission", async () => {
  let executions = 0;
  const victim = identity("victim");
  const { sandbox } = setupSandbox(async () => { executions += 1; return {}; }, { identity: victim });
  for (const alias of [
    identity("other"),
    { ...victim, generationId: "generation-2" },
    { ...victim, namespace: `${victim.namespace}/other` },
  ]) {
    await assert.rejects(sandbox.invoke(invokeRequest(alias, {})), /canonical|locked|identity/i);
  }
  assert.equal(executions, 0);
});

test("exact action retry is idempotent while changed reuse and Indeterminate redispatch remain owner failures", async () => {
  const instanceIdentity = identity();
  const rows = new Map();
  let effects = 0;
  const runtimeKit = createOwnerRuntimeKit({
    host(request) {
      const previous = rows.get(request.idempotencyKey);
      if (previous && previous.requestDigest !== request.requestDigest) {
        return { kind: "MediatedHostActionFailed", code: "idempotency-conflict" };
      }
      if (previous) return previous;
      effects += 1;
      const result = request.indeterminate
        ? { kind: "MediatedHostActionIndeterminate", code: "external-effect-unknown" }
        : { kind: "MediatedHostActionSucceeded" };
      rows.set(request.idempotencyKey, { ...result, requestDigest: request.requestDigest });
      return rows.get(request.idempotencyKey);
    },
  });
  const { sandbox } = setupSandbox(async invocation => invocation.hostAction(invocation.input), {
    runtimeKit, identity: instanceIdentity,
  });
  const exact = hostAction(instanceIdentity);
  const invocation = invokeRequest(instanceIdentity, exact);
  await sandbox.invoke(invocation);
  await sandbox.invoke(invocation);
  assert.equal(effects, 1);
  const changed = hostAction(instanceIdentity, { requestDigest: "changed" });
  assert.equal((await sandbox.invoke(invokeRequest(instanceIdentity, changed))).code, "idempotency-conflict");
  const unknown = hostAction(instanceIdentity, {
    idempotencyKey: "unknown", requestDigest: "unknown", indeterminate: true,
  });
  assert.equal((await sandbox.invoke(invokeRequest(instanceIdentity, unknown))).kind, "MediatedHostActionIndeterminate");
  assert.equal((await sandbox.invoke(invokeRequest(instanceIdentity, unknown))).kind, "MediatedHostActionIndeterminate");
  assert.equal(effects, 2);
});
