import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeStore } from "../packages/manager/src/index.ts";
import { createApplicationControlService, createApplicationManager } from "./helpers/typed-manager.ts";
import { createOwnerRuntimeKit, identity } from "./helpers/owner-fixtures.ts";

function createManager(runtimeKit: any) {
  return createApplicationManager({
    runtimeKit,
    runtimeStore: runtimeKit.store,
    dshAdapter: { lifecycleEffects: {} },
    composition: {},
    trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
  });
}

test("all lifecycle request bytes are forwarded once and application code assigns no state", async () => {
  const observed: { operation: string; request: any; }[] = [];
  const overrides = Object.fromEntries([
    "lock", "start", "resume", "interrupt", "drain", "stop",
  ].map(operation => [operation, (request: any) => {
    observed.push({ operation, request: structuredClone(request) });
    return { kind: `${operation}-owner-result`, requestDigest: request.requestDigest };
  }]));
  const runtimeKit = createOwnerRuntimeKit(overrides);
  const manager = createManager(runtimeKit);
  const instanceIdentity = identity();
  for (const operation of ["lock", "start", "resume", "interrupt", "drain", "stop"]) {
    const request = {
      identity: instanceIdentity,
      idempotencyKey: `${operation}-key`,
      requestDigest: `${operation}-digest`,
      changedCanonicalField: `${operation}-value`,
    };
    assert.deepEqual(await manager[operation]!(request), {
      kind: `${operation}-owner-result`, requestDigest: `${operation}-digest`,
    });
  }
  assert.deepEqual(observed.map(row => row.operation), ["lock", "start", "resume", "interrupt", "drain", "stop"]);
  assert(observed.every(row => row.request.changedCanonicalField === `${row.operation}-value`));
  assert.equal(runtimeKit.store.instances.size, 0, "application forwarding never assigns runtime-kit state");
});

test("assertion freshness, trust lineage, replay, and state conflicts remain unmodified owner results", async () => {
  const ownerResults = [
    { kind: "StartInstanceFailed", code: "assertion-invalid" },
    { kind: "StartInstanceFailed", code: "trust-head-stale" },
    { kind: "StartInstanceFailed", code: "idempotency-conflict" },
    { kind: "StopInstanceFailed", code: "state-conflict" },
    { kind: "StartInstanceIndeterminate", code: "effect-unknown" },
  ];
  for (const expected of ownerResults) {
    const operation = expected.kind.startsWith("Stop") ? "stop" : "start";
    const runtimeKit = createOwnerRuntimeKit({ [operation]: () => expected });
    const manager = createManager(runtimeKit);
    assert.deepEqual(await manager[operation]({ identity: identity() }), expected);
  }
});

test("the complete reconciliation candidate matrix crosses authenticated control only", async () => {
  const observed: { request: any; context: any; }[] = [];
  const runtimeKit = createOwnerRuntimeKit({
    reconcile(request, context) {
      observed.push({ request: structuredClone(request), context: structuredClone(context) });
      return {
        kind: "ReconcileInstanceResult",
        candidate: request.evidenceState,
        evidence: context.evidence.status,
      };
    },
  });
  const manager = createManager(runtimeKit);
  const control = createApplicationControlService({
    runtimeKit,
    manager,
    peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["public-test"] } },
    reconcileEvidence: async (request: any) => ({ status: request.ownerEvidence }),
  });
  const matrix = [
    { operation: "lock", sources: ["Absent"], transient: null, terminal: "Locked" },
    { operation: "start", sources: ["Locked"], transient: "Starting", terminal: "Running" },
    { operation: "resume", sources: ["Interrupted", "Stopped"], transient: "Starting", terminal: "Running" },
    { operation: "interrupt", sources: ["Running"], transient: "Interrupting", terminal: "Interrupted" },
    { operation: "drain", sources: ["Running", "Interrupted"], transient: "Draining", terminal: "Drained" },
    { operation: "stop", sources: ["Drained"], transient: "Stopping", terminal: "Stopped" },
  ];
  let expected = 0;
  for (const row of matrix) {
    for (const source of row.sources) {
      for (const evidenceState of [source, row.transient, row.terminal].filter(Boolean)) {
        const payload = {
          identity: identity(),
          originalOperation: row.operation,
          expectedSourceStates: [source],
          expectedTerminalState: row.terminal,
          evidenceState,
          ownerEvidence: "committed",
        };
        const frame = { operation: "instance.reconcile", payload };
        const result = await control.handle(frame, { peerIdentity: "controller" });
        assert.deepEqual(result, {
          kind: "ReconcileInstanceResult", candidate: evidenceState, evidence: "committed",
        });
        const call = runtimeKit.calls.findLast(candidate => candidate.owner === "control");
        assert.deepEqual(call!.frame, frame, "authenticated frame bytes stay unchanged");
        expected += 1;
      }
    }
  }
  assert.equal(observed.length, expected);
  assert(observed.every(row => row.context.authorized === true && row.context.evidence.status === "committed"));
  assert.equal(manager.reconcile, undefined);
});

test("reconcile evidence classes are resolved inside the authenticated control boundary", async () => {
  const runtimeKit = createOwnerRuntimeKit({
    reconcile: (_request, context) => ({ kind: "owner-reconcile", evidence: context.evidence.status }),
  });
  const manager = createManager(runtimeKit);
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
});
