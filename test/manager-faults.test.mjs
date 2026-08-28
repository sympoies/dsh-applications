import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationManager } from "../packages/manager/src/index.js";
import { createOwnerRuntimeKit, identity } from "./helpers/owner-fixtures.mjs";

function faultOwner() {
  const rows = new Map();
  const state = new Map();
  const effects = [];
  const runtimeKit = createOwnerRuntimeKit(Object.fromEntries(
    ["lock", "start", "resume", "interrupt", "drain", "stop"].map(operation => [operation, request => {
      const namespace = request.identity.namespace;
      const current = state.get(namespace) ?? "Absent";
      const replayKey = `${namespace}\0${operation}\0${request.idempotencyKey}`;
      const replay = rows.get(replayKey);
      if (replay && replay.requestDigest !== request.requestDigest) return { kind: "Failed", code: "idempotency-conflict", observedState: current };
      if (replay) return replay.result;
      const allowed = {
        lock: ["Absent"], start: ["Locked"], resume: ["Interrupted", "Stopped"],
        interrupt: ["Running"], drain: ["Running", "Interrupted"], stop: ["Drained"],
      }[operation];
      if (!allowed.includes(current)) return { kind: "Failed", code: "state-conflict", observedState: current };
      effects.push({ operation, namespace });
      const next = { lock: "Locked", start: "Running", resume: "Running", interrupt: "Interrupted", drain: "Drained", stop: "Stopped" }[operation];
      const result = request.forceIndeterminate
        ? { kind: "Indeterminate", code: "effect-unknown", observedState: current }
        : { kind: "Succeeded", observedState: next, receipt: { requestDigest: request.requestDigest } };
      rows.set(replayKey, { requestDigest: request.requestDigest, result });
      if (!request.forceIndeterminate) state.set(namespace, next);
      return result;
    }]),
  ));
  return { runtimeKit, state, effects };
}

function request(operation, instanceIdentity, overrides = {}) {
  return {
    identity: instanceIdentity,
    idempotencyKey: `${operation}-key`,
    requestDigest: `${operation}-digest`,
    ...overrides,
  };
}

test("CAS replay is exact, changed-request reuse has no effect, and instances are isolated", async () => {
  const owner = faultOwner();
  const manager = createApplicationManager({
    runtimeKit: owner.runtimeKit,
    dshAdapter: { lifecycleEffects: {} },
    composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }),
  });
  const a = identity("a");
  const b = identity("b");
  const original = request("lock", a);
  const first = await manager.lock(original);
  assert.deepEqual(await manager.lock(original), first);
  const before = owner.effects.length;
  assert.equal((await manager.lock({ ...original, requestDigest: "changed" })).code, "idempotency-conflict");
  assert.equal(owner.effects.length, before);
  assert.equal((await manager.lock(request("lock", b))).observedState, "Locked");
  assert.equal(owner.state.get(a.namespace), "Locked");
  assert.equal(owner.state.get(b.namespace), "Locked");
});

test("stop-before-drain fails and Interrupted must drain before stop", async () => {
  const owner = faultOwner();
  const manager = createApplicationManager({ runtimeKit: owner.runtimeKit, dshAdapter: { lifecycleEffects: {} }, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }) });
  const instanceIdentity = identity();
  await manager.lock(request("lock", instanceIdentity));
  await manager.start(request("start", instanceIdentity));
  assert.equal((await manager.stop(request("stop", instanceIdentity))).code, "state-conflict");
  await manager.interrupt(request("interrupt", instanceIdentity));
  assert.equal((await manager.stop(request("stop", instanceIdentity))).code, "state-conflict");
  await manager.drain(request("drain", instanceIdentity));
  assert.equal((await manager.stop(request("stop", instanceIdentity))).observedState, "Stopped");
});

test("indeterminate mutation cannot redispatch and remains runtime-kit reconcile authority", async () => {
  const owner = faultOwner();
  const manager = createApplicationManager({ runtimeKit: owner.runtimeKit, dshAdapter: { lifecycleEffects: {} }, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }) });
  const instanceIdentity = identity();
  await manager.lock(request("lock", instanceIdentity));
  const start = request("start", instanceIdentity, { forceIndeterminate: true });
  assert.equal((await manager.start(start)).kind, "Indeterminate");
  const before = owner.effects.length;
  assert.equal((await manager.start(start)).kind, "Indeterminate");
  assert.equal(owner.effects.length, before);
  assert.equal(manager.reconcile, undefined);
  assert.equal(owner.state.get(instanceIdentity.namespace), "Locked");
});

test("runtime-kit assertion validation precedes terminal replay and trust lineage failures remain owner results", async () => {
  const order = [];
  let cached = false;
  const runtimeKit = createOwnerRuntimeKit({
    start(request) {
      order.push("runtime-kit-validate-assertion");
      if (request.runtimeAssertion?.bundleState !== "active-pinned") {
        return { kind: "StartInstanceFailed", code: request.runtimeAssertion?.bundleState === "rolled-back" ? "trust-head-stale" : "assertion-invalid" };
      }
      if (cached) return { kind: "StartInstanceSucceeded", replay: true };
      cached = true;
      return { kind: "StartInstanceSucceeded", replay: false };
    },
  });
  const manager = createApplicationManager({ runtimeKit, dshAdapter: { lifecycleEffects: {} }, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }) });
  const instanceIdentity = identity();
  const base = request("start", instanceIdentity, { runtimeAssertion: { bundleState: "active-pinned" } });
  assert.equal((await manager.start(base)).replay, false);
  order.length = 0;
  assert.equal((await manager.start({ ...base, runtimeAssertion: { bundleState: "substituted" } })).code, "assertion-invalid");
  assert.deepEqual(order, ["runtime-kit-validate-assertion"]);
  assert.equal((await manager.start({ ...base, runtimeAssertion: { bundleState: "unpinned" } })).code, "assertion-invalid");
  assert.equal((await manager.start({ ...base, runtimeAssertion: { bundleState: "rolled-back" } })).code, "trust-head-stale");
});

test("reconcile candidates are forwarded without application state assignment", async () => {
  const observed = [];
  const runtimeKit = createOwnerRuntimeKit({ reconcile(request, context) {
    observed.push({ request: structuredClone(request), context: structuredClone(context) });
    return { kind: "runtime-kit-reconcile", observedState: request.evidenceState };
  } });
  const manager = createApplicationManager({ runtimeKit, dshAdapter: { lifecycleEffects: {} }, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }) });
  assert.equal(manager.reconcile, undefined);
  const raw = runtimeKit.rawManager;
  for (const row of [
    { operation: "lock", source: "Absent", transient: null, terminal: "Locked" },
    { operation: "start", source: "Locked", transient: "Starting", terminal: "Running" },
    { operation: "interrupt", source: "Running", transient: "Interrupting", terminal: "Interrupted" },
    { operation: "drain", source: "Interrupted", transient: "Draining", terminal: "Drained" },
  ]) {
    for (const evidenceState of [row.source, row.transient, row.terminal].filter(Boolean)) {
      const result = await raw.reconcile({ identity: identity(), originalOperation: row.operation, evidenceState }, { authorized: true, evidence: { status: "committed" } });
      assert.equal(result.observedState, evidenceState);
    }
  }
  assert.equal(observed.length, 11);
});
