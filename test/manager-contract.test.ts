import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_MANAGER_OPERATIONS, type RuntimeStore } from "../packages/manager/src/index.ts";
import { createApplicationControlService, createApplicationManager } from "./helpers/typed-manager.ts";
import { createAdapterHarness, invocation } from "./helpers/adapter-harness.ts";
import { createOwnerRuntimeKit, identity } from "./helpers/owner-fixtures.ts";
import type { DshRc2InstanceRuntime } from "../packages/dsh-rc2-adapter/src/index.ts";

const expectedOperations = [
  "validate", "resolve", "lock", "start", "resume", "status",
  "interrupt", "drain", "stop", "doctor",
];

function managerOptions(runtimeKit: any, dshAdapter = { lifecycleEffects: {} }) {
  return {
    runtimeKit,
    runtimeStore: runtimeKit.store,
    dshAdapter,
    composition: { catalog: "public" },
    trustVerifier: { acceptSignedDocument() {} },
    health: async () => ({ state: "ready", code: "READY" }),
  };
}

test("public application manager exposes exactly the ten reviewed operations", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const manager = createApplicationManager(managerOptions(runtimeKit));

  assert.deepEqual([...PUBLIC_MANAGER_OPERATIONS], expectedOperations);
  assert.deepEqual(Object.keys(manager), expectedOperations);
  for (const operation of expectedOperations) {
    assert.equal(typeof manager[operation], "function");
    assert.deepEqual(await manager[operation]!({ operation }), {
      owner: "runtime-kit", operation, request: { operation },
    });
  }
  for (const forbidden of [
    "reconcile", "install", "update", "rollback", "traffic", "publish",
    "promote", "route", "teardown",
  ]) assert.equal(manager[forbidden], undefined);
});

test("manager requires an explicit owner store and recreation retains shared runtime-kit truth", async () => {
  const runtimeKit = createOwnerRuntimeKit({
    status(request) {
      return { retained: runtimeKit.store.instances.get(request.identity.namespace) };
    },
  });
  assert.throws(() => createApplicationManager({
    ...managerOptions(runtimeKit), runtimeStore: undefined,
  }), /runtimeStore/i);
  const first = createApplicationManager(managerOptions(runtimeKit));
  runtimeKit.store.instances.set(identity().namespace, { state: "Running", receiptHead: "retained" });
  const replacement = createApplicationManager(managerOptions(runtimeKit));
  assert.deepEqual(await replacement.status({ identity: identity() }), {
    retained: { state: "Running", receiptHead: "retained" },
  });
  assert.equal(await first.status({ identity: identity() }).then((result: any) => result.retained.receiptHead), "retained");
  const creations = runtimeKit.calls.filter(call => call.operation === "create-manager");
  assert.equal(creations.length, 2);
  assert(creations.every(call => call.options.store === runtimeKit.store));
});

test("runtime-kit owns composition, lifecycle, the shared store, mediation, and authenticated reconcile", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const manager = createApplicationManager({
    ...managerOptions(runtimeKit, { lifecycleEffects: { start() {} } }),
    host: { authorize: async () => ({ allowed: false, admissionSealDigest: "none" }) },
  });
  const control = createApplicationControlService({
    runtimeKit,
    manager,
    peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["public-test"] } },
    reconcileEvidence: async () => ({ status: "temporary-unavailable" }),
  });
  const reconciled = await control.handle(
    { operation: "instance.reconcile", payload: { identity: identity() } },
    { peerIdentity: "controller" },
  );
  assert.equal(reconciled.owner, "runtime-kit");
  assert.equal(reconciled.operation, "reconcile");
  const managerCreation = runtimeKit.calls.find(call => call.operation === "create-manager")!;
  const hostCreation = runtimeKit.calls.find(call => call.operation === "create-host")!;
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
      const manager = createApplicationManager(managerOptions(runtimeKit));
      const control = createApplicationControlService({
        runtimeKit,
        manager,
        peers: { controller: { operations: [`instance.${operation}`], namespacePrefixes: ["public-test"] } },
        reconcileEvidence: async () => ({ status: "temporary-unavailable" }),
      });
      assert.equal((await control.handle(
        { operation: `instance.${operation}`, payload: { identity: identity() } },
        { peerIdentity: "controller" },
      )).kind, kind);
    }
  }
  const runtimeKit = createOwnerRuntimeKit({
    reconcile: (_request, context) => ({ kind: "ReconcileInstanceResult", evidence: context.evidence.status }),
  });
  const manager = createApplicationManager(managerOptions(runtimeKit));
  for (const status of ["committed", "not-committed", "temporary-unavailable", "authority-unavailable", "conflict"]) {
    const control = createApplicationControlService({
      runtimeKit,
      manager,
      peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["public-test"] } },
      reconcileEvidence: async () => ({ status }),
    });
    assert.equal((await control.handle(
      { operation: "instance.reconcile", payload: { identity: identity() } },
      { peerIdentity: "controller" },
    )).evidence, status);
  }
  assert.equal(manager.reconcile, undefined);
});

test("the rc2 adapter binds isolated agents to DSH-owned tool execution and lifecycle services", async () => {
  const subject = createAdapterHarness();
  const a = identity("a");
  const b = identity("b");
  const c = identity("c");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: a })).sessionIdentity, "session-a");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: b })).sessionIdentity, "session-b");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: c })).sessionIdentity, "session-c");
  assert.notEqual(subject.created[0]!.meta.cwd, subject.created[1]!.meta.cwd);
  assert.notEqual(subject.configured[0]!.runtime.memory, subject.configured[1]!.runtime.memory);
  assert.deepEqual(subject.restrictions, [{ allow: [] }, { allow: [] }, { allow: [] }]);
  assert.equal((await subject.adapter.executePlugin(invocation(a))).value, "ok");
  assert.equal(subject.hostExecutions.length, 1, "execution crosses the agent-scoped DSH tool");
  await subject.adapter.lifecycleEffects.interrupt({ identity: a });
  assert.deepEqual(subject.handles.get("session-a")!.agent.cancelCalls[0], {
    cause: { kind: "user" }, options: undefined,
  });
  await assert.rejects(subject.adapter.executePlugin(invocation(a)), /not accepting/i);
  await subject.adapter.lifecycleEffects.drain({ identity: b });
  assert.deepEqual(subject.handles.get("session-b")!.agent.cancelCalls[0], {
    cause: { kind: "parent" }, options: { keepInbox: true },
  });
  await subject.adapter.lifecycleEffects.stop({ identity: b });
  assert.equal(subject.handles.has("session-b"), false);
  await subject.adapter.lifecycleEffects.resume({ identity: a });
  assert.equal(subject.resumed.length, 0, "a live interrupted agent is reopened without duplicate registration");
  assert.deepEqual(await subject.adapter.executePlugin(invocation(a)), { value: "ok" });
  await subject.adapter.lifecycleEffects.resume({ identity: b });
  assert.equal(subject.resumed[0].resumeSessionId, "session-b");
  subject.handles.delete("session-c");
  await subject.adapter.lifecycleEffects.resume({ identity: c });
  assert.equal(subject.resumed[1].resumeSessionId, "session-c");
  assert.deepEqual(subject.inspectCalls, ["session-b", "session-c"]);
  assert(subject.flushed.includes("session-a"));
});

test("every session, root, and controller collision fails before DSH effects and leaves the first instance usable", async () => {
  const fields = ["sessionId", "root", "memory", "queue", "credentialHandles", "budget", "concurrencyController"];
  for (const field of fields) {
    let firstRuntime: any;
    const subject = createAdapterHarness({
      runtimeFactory(instanceIdentity) {
        const runtime = subject.defaultRuntime(instanceIdentity);
        if (instanceIdentity.instanceId === "a") firstRuntime = runtime;
        if (instanceIdentity.instanceId === "b") runtime[field] = firstRuntime[field];
        return runtime;
      },
    });
    const a = identity("a");
    const b = identity("b");
    assert.equal((await subject.adapter.lifecycleEffects.start({ identity: a })).status, "succeeded", field);
    assert.deepEqual(await subject.adapter.lifecycleEffects.start({ identity: b }), {
      status: "failed", code: "runtime-unavailable",
    }, field);
    assert.equal(subject.created.length, 1, `${field} collision must fail before create`);
    assert.deepEqual(await subject.adapter.executePlugin(invocation(a, { field })), { field });
  }
});

test("failed preparation rolls back every reservation and permits an exact retry", async () => {
  const subject = createAdapterHarness({ failedCreates: 1 });
  const instanceIdentity = identity("retry");
  assert.deepEqual(await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity }), {
    status: "failed", code: "runtime-unavailable",
  });
  assert.equal(subject.releases.length, 1, "failed setup binding is released");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity })).status, "succeeded");
  assert.equal(subject.created.length, 2);
});

test("a setup failure after host binding releases the binding and permits an exact retry", async () => {
  const subject = createAdapterHarness({ failedRegistrations: 1 });
  const instanceIdentity = identity("setup-retry");
  assert.deepEqual(await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity }), {
    status: "failed", code: "runtime-unavailable",
  });
  assert.equal(subject.releases.length, 1, "the already-created host binding is released");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity })).status, "succeeded");
});

test("concurrent starts for one canonical identity publish at most one DSH agent", async () => {
  const runtimeReady = Promise.withResolvers<void>();
  let resolutions = 0;
  let subject: any;
  subject = createAdapterHarness({
    async runtimeFactory(instanceIdentity) {
      resolutions += 1;
      if (resolutions === 1) await runtimeReady.promise;
      return subject.defaultRuntime(instanceIdentity);
    },
  });
  const instanceIdentity = identity("concurrent");
  const first = subject.adapter.lifecycleEffects.start({ identity: instanceIdentity });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity }), {
    status: "failed", code: "runtime-unavailable",
  });
  runtimeReady.resolve();
  assert.equal((await first).status, "succeeded");
  assert.equal(subject.created.length, 1);
});

test("cold resume uses a point lookup and rejects a persisted session at another root", async () => {
  const subject = createAdapterHarness();
  const instanceIdentity = identity("cold");
  await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity });
  await subject.adapter.lifecycleEffects.drain({ identity: instanceIdentity });
  await subject.adapter.lifecycleEffects.stop({ identity: instanceIdentity });
  subject.persisted.set("session-cold", "/isolated/victim");
  assert.deepEqual(await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity }), {
    status: "failed", code: "runtime-unavailable",
  });
  assert.deepEqual(subject.inspectCalls, ["session-cold"]);
  assert.equal(subject.resumed.length, 0);
  subject.persisted.set("session-cold", "/isolated/cold");
  assert.equal((await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity })).status, "succeeded");
  assert.deepEqual(subject.inspectCalls, ["session-cold", "session-cold"]);
});

test("full canonical identity is required before selecting a live sandbox", async () => {
  const subject = createAdapterHarness();
  const victim = identity("victim");
  await subject.adapter.lifecycleEffects.start({ identity: victim });
  for (const alias of [
    { ...victim, profileId: "other" },
    { ...victim, generationId: "other" },
    { ...victim, instanceId: "other" },
    { ...victim, namespace: `${victim.namespace}/alias` },
    { ...victim, extra: "field" },
  ]) {
    await assert.rejects(subject.adapter.executePlugin(invocation(alias)), /identity|canonical|fields/i);
  }
  assert.equal(subject.hostExecutions.length, 0);
});

test("confinement proof and execution share one captured entry and stop fences before disposal", async () => {
  const proof = Promise.withResolvers<void>();
  const execution = Promise.withResolvers<any>();
  let disposeAllowed = false;
  const subject = createAdapterHarness({
    assertCurrent: () => proof.promise,
    execute: () => execution.promise,
    beforeDispose: async () => { assert.equal(disposeAllowed, true); },
  });
  const instanceIdentity = identity("race");
  await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity });
  const pendingProof = subject.adapter.executePlugin(invocation(instanceIdentity));
  const drain = subject.adapter.lifecycleEffects.drain({ identity: instanceIdentity });
  proof.resolve();
  await assert.rejects(pendingProof, /changed|accepting|aborted/i);
  await drain;
  assert.equal(subject.hostExecutions.length, 0, "a fenced proof cannot dispatch");

  await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity });
  const pendingExecution = subject.adapter.executePlugin(invocation(instanceIdentity));
  await new Promise(resolve => setImmediate(resolve));
  const stopping = subject.adapter.lifecycleEffects.stop({ identity: instanceIdentity });
  await assert.rejects(subject.adapter.executePlugin(invocation(instanceIdentity)), /not accepting/i);
  assert.deepEqual(await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity }), {
    status: "failed", code: "runtime-unavailable",
  }, "resume cannot reopen a stopping entry");
  let stopped = false;
  stopping.then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false, "stop waits for the captured in-flight tool");
  disposeAllowed = true;
  execution.resolve({ completed: true });
  assert.deepEqual(await pendingExecution, { completed: true });
  await stopping;
});

test("stop retries only unfinished release and dispose phases", async () => {
  for (const failure of ["release", "dispose"]) {
    const subject = createAdapterHarness({
      failedReleases: failure === "release" ? 1 : 0,
      failedDisposals: failure === "dispose" ? 1 : 0,
    });
    const instanceIdentity = identity(`stop-${failure}`);
    await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity });
    await assert.rejects(
      subject.adapter.lifecycleEffects.stop({ identity: instanceIdentity }),
      /disposal failed/i,
    );
    assert.deepEqual(await subject.adapter.lifecycleEffects.stop({ identity: instanceIdentity }), {
      status: "succeeded",
      retainedStateDisposition: "retained",
    });
    assert.equal(subject.releaseCompletions.length, 1, `${failure}: release completes once`);
    assert.equal(subject.disposeCompletions.length, 1, `${failure}: dispose completes once`);
    assert.equal(subject.releases.length, failure === "release" ? 2 : 1, `${failure}: release attempts`);
    assert.equal(subject.disposeAttempts.length, failure === "dispose" ? 2 : 1, `${failure}: dispose attempts`);
  }
});

test("stale resume retries unfinished retirement before reopening the session", async () => {
  const subject = createAdapterHarness({ failedReleases: 1 });
  const instanceIdentity = identity("stale-retry");
  await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity });
  subject.handles.delete("session-stale-retry");
  assert.deepEqual(await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity }), {
    status: "failed", code: "runtime-unavailable",
  });
  assert.equal((await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity })).status, "succeeded");
  assert.equal(subject.releaseCompletions.length, 1);
  assert.equal(subject.disposeCompletions.length, 1);
  assert.equal(subject.resumed.length, 1);
});

test("the adapter revokes a retained host capability before in-flight accounting ends", async () => {
  let retainedHostAction: any;
  let hostEffects = 0;
  const subject = createAdapterHarness({
    execute(invocation) {
      retainedHostAction = invocation.hostAction;
      return invocation.input;
    },
  });
  const instanceIdentity = identity("retained-capability");
  await subject.adapter.lifecycleEffects.start({ identity: instanceIdentity });
  await subject.adapter.executePlugin({
    ...invocation(instanceIdentity),
    async hostAction(request) { hostEffects += 1; return request; },
  });
  await assert.rejects(retainedHostAction({ late: true }), /active|revoked|settled/i);
  await subject.adapter.lifecycleEffects.stop({ identity: instanceIdentity });
  await subject.adapter.lifecycleEffects.resume({ identity: instanceIdentity });
  await assert.rejects(retainedHostAction({ later: true }), /active|revoked|settled/i);
  assert.equal(hostEffects, 0);
});

test("a sandbox owner without release retires an instance and frees its reservation on stop", async () => {
  const subject = createAdapterHarness({ omitRelease: true });
  const a = identity("a");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: a })).status, "succeeded");
  assert.deepEqual(await subject.adapter.lifecycleEffects.stop({ identity: a }), {
    status: "succeeded",
    retainedStateDisposition: "retained",
  });
  assert.deepEqual(subject.releases, [], "no release owner exists to call");
  assert.equal(subject.disposeCompletions.length, 1, "the agent handle is still disposed");
  // The reservation is gone: the same session and root can be claimed again.
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: a })).status, "succeeded");
});
