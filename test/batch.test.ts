import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createApplicationControlService, createApplicationManager } from "./helpers/typed-manager.ts";

const profile = JSON.parse(
  readFileSync(new URL("../profiles/batch/profile.json", import.meta.url), "utf8"),
);
const manualFixture = JSON.parse(
  readFileSync(new URL("../fixtures/triggers/manual.json", import.meta.url), "utf8"),
);
const scheduleFixture = JSON.parse(
  readFileSync(new URL("../fixtures/triggers/schedule.json", import.meta.url), "utf8"),
);

test("the batch profile declares one authority shared by manual and scheduled invocation", () => {
  assert.equal(profile.workload.class, "batch");
  assert.equal(profile.workload.scopeClass, "non-project");
  assert.deepEqual([...profile.grants].sort(), ["batch.input.read", "batch.output.write"]);
  assert.deepEqual(profile.limits.networkClasses, []);
  assert.deepEqual(profile.limits.workspaceClasses, []);
  assert.equal(profile.state.session, "ephemeral");
  assert.equal(profile.state.memory, "none");
  assert.equal(profile.state.workspace, "none");
  assert.equal(profile.state.restart, "fresh");

  // Both trigger classes bind the SAME input schema: scheduling is reusable
  // trigger configuration, never a second persona or a widened authority.
  assert.deepEqual(profile.triggers.map((trigger: any) => trigger.class).sort(), ["manual", "schedule"]);
  const schemaDigests = new Set(profile.triggers.map((trigger: any) => trigger.inputSchemaDigest));
  assert.equal(schemaDigests.size, 1, "manual and schedule triggers share one input schema");

  // The declared overlap rule is forbid with single-slot concurrency, and
  // retry/timeout are bounded and explicit.
  assert.equal(profile.execution.overlap, "forbid");
  assert.equal(profile.execution.concurrency, 1);
  assert.equal(profile.execution.retry.maxAttempts, 3);
  assert.equal(profile.execution.timeoutMs, 3_600_000);
  assert.equal(profile.execution.drain, "required");

  // Trigger fixtures carry configuration only: an id, a class, and an input
  // schema digest - no grants, approvals, or authority keys to widen.
  for (const fixture of [manualFixture, scheduleFixture]) {
    assert.deepEqual(Object.keys(fixture.descriptor).sort(), ["class", "id", "inputSchemaDigest"]);
  }
  assert.equal(manualFixture.profileClass, "manual");
  assert.equal(scheduleFixture.profileClass, "schedule");
});

const exactRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactAvailable = existsSync(join(exactRoot, "src/manager/index.js"));
// A broken checkout layout must fail, never silently skip, when the exact
// runtime-kit root was requested explicitly (the CI posture).
assert(
  !process.env.DSH_RUNTIME_KIT_ROOT || exactAvailable,
  `DSH_RUNTIME_KIT_ROOT is set but ${exactRoot} has no runtime-kit manager`,
);

async function exactHarness() {
  const composition = await import(pathToFileURL(join(exactRoot, "src/composition/index.js")).href);
  const runtimeManager = await import(pathToFileURL(join(exactRoot, "src/manager/index.js")).href);
  const fixtures = await import(pathToFileURL(join(exactRoot, "test/helpers/manager-fixtures.mjs")).href);
  const runtimeKit = { ...composition, ...runtimeManager };

  // The admitted composition's authority is DERIVED FROM THE BATCH PROFILE
  // document, so a drift in the profile's grants or limits fails these
  // runtime proofs, not just the static literal assertions above.
  const resolved = fixtures.composition("non-project", {
    profile: {
      id: profile.metadata.id,
      version: profile.metadata.version,
      digest: profile.metadata.digest,
      workloadClass: profile.workload.class,
      scopeClass: profile.workload.scopeClass,
    },
    authorityCeiling: {
      capabilities: [...profile.grants].sort(),
      networkClasses: [...profile.limits.networkClasses],
      workspaceClasses: [...profile.limits.workspaceClasses],
    },
    modelRouteClass: profile.modelRouteClass,
    isolation: {
      workspaceClass: profile.state.workspace,
      sessionClass: profile.state.session,
      memoryClass: profile.state.memory,
    },
  });
  const lock = fixtures.compositionLock(resolved);
  const signing = fixtures.signingFixture();
  const bundle = fixtures.trustBundle(signing);

  function admitted(instanceId: string) {
    const identity = fixtures.identity({
      deploymentId: "batch-service", profileId: "batch", instanceId,
    });
    const seal = fixtures.admissionSeal(resolved, lock, identity, signing, bundle);
    const request = fixtures.baseLockRequest(resolved, lock, identity, seal);
    request.requestDigest = runtimeManager.computeSemanticRequestDigest(request);
    request.runtimeAssertion = fixtures.runtimeAssertion(
      seal, identity, signing, bundle, "lock", request.requestDigest,
    );
    request.runtimeAssertionDigest = (request.runtimeAssertion as any).metadata.digest;
    return { identity, seal, request };
  }

  function startRequest(subject: any, priorReceiptDigest: any, idempotencyKey: any) {
    const request = {
      apiVersion: "runtime.sympoies.dev/v1",
      kind: "StartInstanceRequest",
      requestId: `${idempotencyKey}-id`,
      idempotencyKey,
      requestDigest: fixtures.ZERO_DIGEST,
      identity: structuredClone(subject.identity),
      priorReceiptDigest,
      admissionSealDigest: subject.seal.metadata.digest,
      runtimeAssertion: null,
      runtimeAssertionDigest: null,
      expectedState: "Locked",
    };
    request.requestDigest = runtimeManager.computeSemanticRequestDigest(request);
    request.runtimeAssertion = fixtures.runtimeAssertion(
      subject.seal, subject.identity, signing, bundle, "start", request.requestDigest,
    );
    request.runtimeAssertionDigest = (request.runtimeAssertion as any).metadata.digest;
    return request;
  }

  function managerFor(store: any, effects: any) {
    return createApplicationManager({
      runtimeKit,
      runtimeStore: store,
      dshAdapter: { lifecycleEffects: effects },
      composition: {
        validatorVersion: "1.0.0",
        resolverVersion: "1.0.0",
        resolvePublicPolicy() { return null; },
      },
      trustVerifier: fixtures.acceptingTrustVerifier(),
      health: async () => ({ state: "ready", code: "READY" }),
    });
  }

  return { runtimeKit, runtimeManager, composition, fixtures, admitted, startRequest, managerFor };
}

test("manual and scheduled batch instances lock against one identical seal and composition", { skip: !exactAvailable }, async () => {
  const { runtimeKit, composition, admitted, managerFor } = await exactHarness();
  const store = runtimeKit.createMemoryRuntimeStore();
  const manager = managerFor(store, {});

  const manual = admitted("manual-run-1");
  const scheduled = admitted("tick-20260831-0200");
  const manualLock = await manager.lock(manual.request);
  const scheduledLock = await manager.lock(scheduled.request);
  assert.equal(manualLock.kind, "LockInstanceSucceeded");
  assert.equal(scheduledLock.kind, "LockInstanceSucceeded");

  // Lock-and-seal parity: both invocation paths admit the SAME composition
  // lock and resolved composition, so the effective capability set is one
  // authority document regardless of the trigger that fired.
  assert.equal(
    manualLock.receipt.compositionLockReceiptDigest,
    scheduledLock.receipt.compositionLockReceiptDigest,
  );
  assert.equal(
    manualLock.receipt.resolvedCompositionDigest,
    scheduledLock.receipt.resolvedCompositionDigest,
  );

  // The parity is profile-derived, not fixture-trivial: each instance gets
  // its own seal, both seals bind one effective-authority digest, and that
  // digest equals a document recomputed independently from the batch
  // profile's grants and limits. A grant or limit drift in
  // profiles/batch/profile.json fails this runtime proof.
  const expectedAuthority = {
    capabilities: [...profile.grants].sort(),
    networkClasses: [...profile.limits.networkClasses],
    workspaceClasses: [...profile.limits.workspaceClasses],
    resourceClasses: ["shared"],
  };
  const expectedDigest = composition.domainSeparatedDigest(
    "sympoies/private-effective-authority/v1", expectedAuthority,
  );
  assert.notEqual(manual.seal.metadata.digest, scheduled.seal.metadata.digest);
  assert.equal(manual.seal.effectiveAuthorityDigest, expectedDigest);
  assert.equal(scheduled.seal.effectiveAuthorityDigest, expectedDigest);
  assert.deepEqual(manual.seal.effectiveAuthority, expectedAuthority);
  assert.deepEqual(scheduled.seal.effectiveAuthority, expectedAuthority);
});

test("a schedule tick has one stable identity: replays are exact and overlap is forbidden", { skip: !exactAvailable }, async () => {
  const { runtimeKit, admitted, startRequest, managerFor } = await exactHarness();
  const store = runtimeKit.createMemoryRuntimeStore();
  const manager = managerFor(store, {
    start: async () => ({ status: "succeeded", sessionIdentity: "tick-session" }),
  });

  const tick = admitted("tick-20260831-0300");
  const locked = await manager.lock(tick.request);
  assert.equal(locked.kind, "LockInstanceSucceeded");
  assert.deepEqual(await manager.lock(tick.request), locked, "tick lock replay is byte-stable");

  const start = startRequest(tick, locked.receipt.digest, "tick-20260831-0300-attempt-1");
  const started = await manager.start(start);
  assert.equal(started.kind, "StartInstanceSucceeded");
  assert.deepEqual(await manager.start(start), started, "tick start replay is byte-stable");

  // Overlap: a second start for the same tick identity while it is Running
  // fails closed with a state conflict - the declared forbid rule.
  const overlapping = await manager.start(
    startRequest(tick, started.receipt.digest, "tick-20260831-0300-attempt-2"),
  );
  assert.equal(overlapping.kind, "StartInstanceFailed");
  assert.equal(overlapping.code, "state-conflict");
});

test("a retryable tick failure keeps its exact terminal result and a fresh attempt succeeds", { skip: !exactAvailable }, async () => {
  const { runtimeKit, admitted, startRequest, managerFor } = await exactHarness();
  const store = runtimeKit.createMemoryRuntimeStore();
  let failuresRemaining = 1;
  const manager = managerFor(store, {
    start: async () => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return { status: "failed", code: "runtime-unavailable" };
      }
      return { status: "succeeded", sessionIdentity: "tick-session" };
    },
  });

  const tick = admitted("tick-20260831-0400");
  const locked = await manager.lock(tick.request);
  const firstAttempt = startRequest(tick, locked.receipt.digest, "tick-20260831-0400-attempt-1");
  const failed = await manager.start(firstAttempt);
  assert.equal(failed.kind, "StartInstanceFailed");
  assert.equal(failed.code, "runtime-unavailable");
  assert.equal(failed.retryable, true);

  // A bounded retry is a NEW attempt with its own idempotency key; the
  // failed attempt's terminal result stays pinned to its key forever.
  // The attempt CEILING (execution.retry.maxAttempts) is scheduler-side
  // trigger configuration: the runtime pins per-attempt terminal results
  // and the static profile assertion pins the declared bound.
  const secondAttempt = startRequest(tick, locked.receipt.digest, "tick-20260831-0400-attempt-2");
  const retried = await manager.start(secondAttempt);
  assert.equal(retried.kind, "StartInstanceSucceeded");
  const replayedFailure = await manager.start(firstAttempt);
  assert.equal(replayedFailure.kind, "StartInstanceFailed");
  assert.equal(replayedFailure.code, "runtime-unavailable");
});

test("a schedule trigger peer can observe but never drive lifecycle operations", { skip: !exactAvailable }, async () => {
  const { runtimeKit, runtimeManager, fixtures, admitted, startRequest, managerFor } = await exactHarness();
  const store = runtimeKit.createMemoryRuntimeStore();
  const manager = managerFor(store, {
    start: async () => ({ status: "succeeded", sessionIdentity: "tick-session" }),
  });
  const tick = admitted("tick-20260831-0500");
  const locked = await manager.lock(tick.request);
  assert.equal(locked.kind, "LockInstanceSucceeded");

  const control = createApplicationControlService({
    runtimeKit,
    manager,
    peers: {
      // The schedule trigger is configuration: at most it may observe status.
      "schedule-trigger": { operations: ["status"], namespacePrefixes: ["batch-service"] },
      // Lifecycle authority stays with the private infra controller.
      controller: {
        operations: ["status", "start", "interrupt", "drain", "stop", "reconcile"],
        namespacePrefixes: ["batch-service"],
      },
    },
    reconcileEvidence: async () => ({ status: "temporary-unavailable" }),
  });

  function frame(payload: any, nonce: string) {
    const value = {
      apiVersion: "runtime.sympoies.dev/v1",
      kind: "ManagerControlRequestFrame",
      protocolVersion: runtimeManager.CONTROL_PROTOCOL_VERSION,
      connectionNonce: nonce,
      payloadKind: payload.kind,
      payload: structuredClone(payload),
      frameDigest: fixtures.ZERO_DIGEST,
    };
    value.frameDigest = runtimeManager.computeManagerDocumentDigest(value);
    return value;
  }

  const statusPayload = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "StatusInstanceRequest",
    requestId: "trigger-status",
    identity: structuredClone(tick.identity),
    receiptChainHead: locked.receipt.digest,
  };
  const observed = await control.handle(frame(statusPayload, "1"), { peerIdentity: "schedule-trigger" });
  assert.equal(observed.payload.observedState, "Locked", "the trigger may observe status");

  // The same peer must not start, drain, or stop the instance.
  const startPayload = startRequest(tick, locked.receipt.digest, "trigger-start-attempt");
  await assert.rejects(
    control.handle(frame(startPayload, "2"), { peerIdentity: "schedule-trigger" }),
    (error: any) => {
      // The refusal must come from the peer-OPERATIONS gate, never the
      // namespace gate, so granting the trigger start can never hide
      // behind a drifted namespace prefix.
      assert.match(error.message, /operation is not allowed for this peer/u);
      assert.equal(error.code, "unauthorized");
      return true;
    },
    "a schedule trigger can never drive lifecycle",
  );

  // The controller peer retains exactly that authority.
  const started = await control.handle(frame(startPayload, "3"), { peerIdentity: "controller" });
  assert.equal(started.payload.kind, "StartInstanceSucceeded");
});
