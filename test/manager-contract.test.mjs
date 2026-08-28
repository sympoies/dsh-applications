import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_MANAGER_OPERATIONS,
  createApplicationControlService,
  createApplicationManager,
} from "../packages/manager/src/index.js";
import { createDshRc2Adapter } from "../packages/dsh-rc2-adapter/src/index.js";
import { createOwnerRuntimeKit, identity } from "./helpers/owner-fixtures.mjs";

const expectedOperations = [
  "validate", "resolve", "lock", "start", "resume", "status",
  "interrupt", "drain", "stop", "doctor",
];

test("public application manager exposes exactly the ten reviewed operations", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const dshAdapter = { lifecycleEffects: Object.freeze({}) };
  const manager = createApplicationManager({
    runtimeKit,
    dshAdapter,
    composition: { catalog: "public" },
    trustVerifier: { acceptSignedDocument() {} },
    health: async () => ({ state: "ready", code: "READY" }),
  });

  assert.deepEqual([...PUBLIC_MANAGER_OPERATIONS], expectedOperations);
  assert.deepEqual(Object.keys(manager), expectedOperations);
  for (const operation of expectedOperations) {
    assert.equal(typeof manager[operation], "function");
    assert.deepEqual(await manager[operation]({ operation }), {
      owner: "runtime-kit", operation, request: { operation },
    });
  }
  for (const forbidden of [
    "reconcile", "install", "update", "rollback", "traffic", "publish",
    "promote", "route", "teardown",
  ]) assert.equal(manager[forbidden], undefined);
});

test("runtime-kit owns composition, lifecycle, the shared store, mediation, and authenticated reconcile", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const manager = createApplicationManager({
    runtimeKit,
    dshAdapter: { lifecycleEffects: { start() {} } },
    composition: { catalog: "public" },
    trustVerifier: { acceptSignedDocument() {} },
    health: async () => ({ state: "ready", code: "READY" }),
    host: { authorize: async () => ({ allowed: false, admissionSealDigest: "none" }) },
  });
  const control = createApplicationControlService({
    runtimeKit,
    manager,
    peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["public-test"] } },
    reconcileEvidence: async () => ({ status: "temporary-unavailable" }),
  });
  const reconciled = await control.handle({ operation: "instance.reconcile", payload: { identity: identity() } }, { peerIdentity: "controller" });
  assert.equal(reconciled.owner, "runtime-kit");
  assert.equal(reconciled.operation, "reconcile");
  const managerCreation = runtimeKit.calls.find(call => call.operation === "create-manager");
  const hostCreation = runtimeKit.calls.find(call => call.operation === "create-host");
  assert.equal(managerCreation.options.store, hostCreation.options.store);
  assert.equal(typeof managerCreation.options.compositionService.resolve, "function");
});

test("authenticated control maps all ten public frames and keeps reconcile internal", async () => {
  const resultKinds = {
    validate: ["ValidateCompositionSucceeded", "ValidateCompositionFailed"],
    resolve: ["ResolveCompositionSucceeded", "ResolveCompositionFailed"],
    lock: ["LockInstanceSucceeded", "LockInstanceFailed", "LockInstanceIndeterminate"],
    start: ["StartInstanceSucceeded", "StartInstanceFailed", "StartInstanceIndeterminate"],
    resume: ["ResumeInstanceSucceeded", "ResumeInstanceFailed", "ResumeInstanceIndeterminate"],
    status: ["StatusInstanceSucceeded", "StatusInstanceFailed"],
    interrupt: ["InterruptInstanceSucceeded", "InterruptInstanceFailed", "InterruptInstanceIndeterminate"],
    drain: ["DrainInstanceSucceeded", "DrainInstanceFailed", "DrainInstanceIndeterminate"],
    stop: ["StopInstanceSucceeded", "StopInstanceFailed", "StopInstanceIndeterminate"],
    doctor: ["DoctorInstanceSucceeded", "DoctorInstanceFailed"],
  };
  for (const [operation, variants] of Object.entries(resultKinds)) {
    for (const kind of variants) {
      const runtimeKit = createOwnerRuntimeKit({ [operation]: () => ({ kind }) });
      const manager = createApplicationManager({ runtimeKit, dshAdapter: { lifecycleEffects: {} }, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }) });
      const control = createApplicationControlService({ runtimeKit, manager, peers: { controller: { operations: [`instance.${operation}`], namespacePrefixes: ["public-test"] } }, reconcileEvidence: async () => ({ status: "temporary-unavailable" }) });
      assert.equal((await control.handle({ operation: `instance.${operation}`, payload: { identity: identity() } }, { peerIdentity: "controller" })).kind, kind);
    }
  }
  const runtimeKit = createOwnerRuntimeKit({ reconcile: (_request, context) => ({ kind: "ReconcileInstanceResult", evidence: context.evidence.status }) });
  const manager = createApplicationManager({ runtimeKit, dshAdapter: { lifecycleEffects: {} }, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }) });
  for (const status of ["committed", "not-committed", "temporary-unavailable", "authority-unavailable", "conflict"]) {
    const control = createApplicationControlService({ runtimeKit, manager, peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["public-test"] } }, reconcileEvidence: async () => ({ status }) });
    assert.equal((await control.handle({ operation: "instance.reconcile", payload: { identity: identity(), sourceState: "Absent", transientState: null, terminalState: "Locked" } }, { peerIdentity: "controller" })).evidence, status);
  }
  assert.equal(manager.reconcile, undefined);
});

test("the rc2 adapter creates isolated DSH agents and uses public lifecycle services only", async () => {
  const created = [];
  const resumed = [];
  const flushed = [];
  const handles = new Map();
  const persisted = new Set();
  const configured = [];
  const getCalls = [];
  const ctx = {
    agents: {
      async create(options) {
        created.push({ sessionId: options.sessionId, meta: structuredClone(options.meta), agentOptions: structuredClone(options.agentOptions) });
        await options.setup({ tools: { register() {}, restrict() {}, guard() {}, async execute() {} } });
        const handle = makeHandle(options.sessionId);
        handles.set(options.sessionId, handle);
        persisted.add(options.sessionId);
        return handle;
      },
      async resume(options) {
        resumed.push({ resumeSessionId: options.resumeSessionId, agentOptions: structuredClone(options.agentOptions) });
        await options.setup({ tools: { register() {}, restrict() {}, guard() {}, async execute() {} } });
        const handle = makeHandle(options.resumeSessionId);
        handles.set(options.resumeSessionId, handle);
        return handle;
      },
      get(sessionId) {
        getCalls.push(sessionId);
        return handles.get(sessionId)?.agent;
      },
    },
    sessions: { async flush(session) { flushed.push(session.id); } },
    sessionPersistence: {
      async inspect(sessionId) { return { meta: { id: sessionId }, events: [] }; },
      async list() { return [...persisted].map(id => ({ id })); },
    },
    tools: { register() {}, guard() {}, restrict() {}, async execute(input) { return { isError: false, value: input.arguments }; } },
  };
  function makeHandle(sessionId) {
    const agent = {
      id: sessionId,
      session: { id: sessionId },
      status: "idle",
      cancelCalls: [],
      cancel(cause, options) { this.cancelCalls.push({ cause, options }); },
      async whenIdle() {},
    };
    return { agent, async dispose() { handles.delete(sessionId); } };
  }
  const adapter = createDshRc2Adapter({
    ctx,
    resolveInstanceRuntime(instanceIdentity) {
      return {
        sessionId: `session-${instanceIdentity.instanceId}`,
        root: `/isolated/${instanceIdentity.instanceId}`,
        agentOptions: { provider: `provider-${instanceIdentity.instanceId}` },
        memory: { namespace: `memory-${instanceIdentity.instanceId}` },
        queue: { namespace: `queue-${instanceIdentity.instanceId}` },
        credentialHandles: { namespace: `credentials-${instanceIdentity.instanceId}` },
        budget: { namespace: `budget-${instanceIdentity.instanceId}` },
        concurrencyController: { namespace: `concurrency-${instanceIdentity.instanceId}` },
        sandbox: {
          kind: "dsh-rc2-enforced",
          deniedAmbient: ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"],
          async execute() {},
          async assertCurrentConfinement(subject) {
            return { owner: "DSH", enforced: true, namespace: subject.namespace, generationId: subject.generationId, scopeRevision: "1", deniedAmbient: this.deniedAmbient };
          },
        },
        async configureScope(_agentCtx, runtime) { configured.push(runtime); },
      };
    },
  });
  const a = identity("a");
  const b = identity("b");
  const c = identity("c");
  assert.equal((await adapter.lifecycleEffects.start({ identity: a })).sessionIdentity, "session-a");
  assert.equal((await adapter.lifecycleEffects.start({ identity: b })).sessionIdentity, "session-b");
  assert.equal((await adapter.lifecycleEffects.start({ identity: c })).sessionIdentity, "session-c");
  assert.notEqual(created[0].meta.cwd, created[1].meta.cwd);
  assert.notEqual(created[0].agentOptions.provider, created[1].agentOptions.provider);
  assert.notEqual(configured[0].memory, configured[1].memory);
  assert.notEqual(configured[0].queue, configured[1].queue);
  assert.notEqual(configured[0].credentialHandles, configured[1].credentialHandles);
  assert.notEqual(configured[0].budget, configured[1].budget);
  assert.notEqual(configured[0].concurrencyController, configured[1].concurrencyController);
  await adapter.lifecycleEffects.interrupt({ identity: a });
  assert.deepEqual(handles.get("session-a").agent.cancelCalls[0], { cause: { kind: "user" }, options: undefined });
  await assert.rejects(adapter.executePlugin({ identity: a }), /not accepting/i);
  await adapter.lifecycleEffects.drain({ identity: b });
  assert.deepEqual(handles.get("session-b").agent.cancelCalls[0], { cause: { kind: "parent" }, options: { keepInbox: true } });
  await adapter.lifecycleEffects.stop({ identity: b });
  assert.equal(handles.has("session-b"), false);
  await adapter.lifecycleEffects.resume({ identity: a });
  assert.equal(resumed.length, 0, "an interrupted live agent resumes without a duplicate DSH registration");
  await adapter.executePlugin({ identity: a });
  await adapter.lifecycleEffects.resume({ identity: b });
  assert.equal(resumed[0].resumeSessionId, "session-b");
  handles.delete("session-c");
  await adapter.lifecycleEffects.resume({ identity: c });
  assert.equal(resumed[1].resumeSessionId, "session-c", "a stale in-memory handle falls back to persisted cold resume");
  assert.deepEqual(getCalls, ["session-a", "session-c"]);
  assert(flushed.includes("session-a"));
});
