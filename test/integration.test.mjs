import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createApplicationControlService, createApplicationManager, createPluginSandbox } from "../packages/manager/src/index.js";
import { definePlugin } from "../packages/plugin-sdk/src/index.js";
import {
  admitRunningPlugin,
  createOwnerRuntimeKit,
  hostAction,
  identity,
  pluginDescriptor,
} from "./helpers/owner-fixtures.mjs";

test("manager and sandbox compose runtime-kit and DSH seams without owning private deployment operations", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const dshAdapter = {
    lifecycleEffects: {},
    async executePlugin(invocation) { return invocation.hostAction(invocation.input); },
  };
  const instanceIdentity = identity();
  const manager = createApplicationManager({ runtimeKit, runtimeStore: runtimeKit.store, dshAdapter, composition: {}, trustVerifier: {}, health: async () => ({ state: "ready", code: "READY" }), host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) } });
  const admission = admitRunningPlugin(runtimeKit, instanceIdentity);
  const sandbox = createPluginSandbox({ runtimeKit, manager, dshAdapter, ...admission });
  const action = hostAction(instanceIdentity);
  const result = await sandbox.invoke({ pluginId: "review", actionId: "review.pull-request", identity: instanceIdentity, input: action });
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
  const runtimeStore = runtimeKit.createMemoryRuntimeStore();
  const manager = createApplicationManager({
    runtimeKit,
    runtimeStore,
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

test("exact runtime-kit owns restart, replay, lifecycle ordering, and authenticated indeterminate recovery", { skip: !exactAvailable }, async () => {
  const composition = await import(pathToFileURL(join(exactRoot, "src/composition/index.js")));
  const runtimeManager = await import(pathToFileURL(join(exactRoot, "src/manager/index.js")));
  const fixtures = await import(pathToFileURL(join(exactRoot, "test/helpers/manager-fixtures.mjs")));
  const runtimeKit = { ...composition, ...runtimeManager };

  function admittedFixture() {
    const resolved = fixtures.composition();
    const lock = fixtures.compositionLock(resolved);
    const instanceIdentity = fixtures.identity();
    const signing = fixtures.signingFixture();
    const bundle = fixtures.trustBundle(signing);
    const seal = fixtures.admissionSeal(resolved, lock, instanceIdentity, signing, bundle);
    const request = fixtures.baseLockRequest(resolved, lock, instanceIdentity, seal);
    request.requestDigest = runtimeManager.computeSemanticRequestDigest(request);
    request.runtimeAssertion = fixtures.runtimeAssertion(
      seal, instanceIdentity, signing, bundle, "lock", request.requestDigest,
    );
    request.runtimeAssertionDigest = request.runtimeAssertion.metadata.digest;
    return { resolved, lock, instanceIdentity, signing, bundle, seal, request };
  }

  function assertionRequest(subject, operation, priorReceiptDigest, expectedState, overrides = {}) {
    const request = {
      apiVersion: "runtime.sympoies.dev/v1",
      kind: `${operation[0].toUpperCase()}${operation.slice(1)}InstanceRequest`,
      requestId: `${operation}-request`,
      idempotencyKey: `${operation}-key`,
      requestDigest: fixtures.ZERO_DIGEST,
      identity: structuredClone(subject.instanceIdentity),
      priorReceiptDigest,
      admissionSealDigest: subject.seal.metadata.digest,
      runtimeAssertion: null,
      runtimeAssertionDigest: null,
      expectedState,
      ...overrides,
    };
    request.requestDigest = runtimeManager.computeSemanticRequestDigest(request);
    request.runtimeAssertion = fixtures.runtimeAssertion(
      subject.seal, subject.instanceIdentity, subject.signing, subject.bundle,
      operation, request.requestDigest,
    );
    request.runtimeAssertionDigest = request.runtimeAssertion.metadata.digest;
    return request;
  }

  function managerFor(store, effects) {
    const dshAdapter = { lifecycleEffects: effects };
    return createApplicationManager({
      runtimeKit,
      runtimeStore: store,
      dshAdapter,
      composition: {
        validatorVersion: "1.0.0",
        resolverVersion: "1.0.0",
        resolvePublicPolicy() { return null; },
      },
      trustVerifier: fixtures.acceptingTrustVerifier(),
      health: async () => ({ state: "ready", code: "READY" }),
    });
  }

  const subject = admittedFixture();
  const store = runtimeKit.createMemoryRuntimeStore();
  const effects = {
    start: async () => ({ status: "succeeded", sessionIdentity: "session-review" }),
    interrupt: async () => ({ status: "succeeded" }),
    drain: async () => ({ status: "succeeded" }),
    stop: async () => ({ status: "succeeded", retainedStateDisposition: "retained" }),
  };
  const manager = managerFor(store, effects);
  const locked = await manager.lock(subject.request);
  assert.equal(locked.kind, "LockInstanceSucceeded");
  assert.deepEqual(await manager.lock(subject.request), locked, "exact lock replay is stable");
  const replacement = managerFor(store, effects);
  assert.equal((await replacement.status({
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "StatusInstanceRequest",
    requestId: "restart-status",
    identity: subject.instanceIdentity,
    receiptChainHead: locked.receipt.digest,
  })).observedState, "Locked", "replacement manager reads the same owner store");

  const start = assertionRequest(subject, "start", locked.receipt.digest, "Locked");
  const started = await replacement.start(start);
  assert.equal(started.kind, "StartInstanceSucceeded");
  const changed = assertionRequest(subject, "start", fixtures.ONE_DIGEST, "Locked");
  assert.equal((await replacement.start(changed)).code, "idempotency-conflict");
  const prematureStop = {
    apiVersion: "runtime.sympoies.dev/v1", kind: "StopInstanceRequest",
    requestId: "stop-premature", idempotencyKey: "stop-premature", requestDigest: fixtures.ZERO_DIGEST,
    identity: subject.instanceIdentity, expectedState: "Drained", receiptChainHead: started.receipt.digest,
  };
  prematureStop.requestDigest = runtimeManager.computeSemanticRequestDigest(prematureStop);
  assert.equal((await replacement.stop(prematureStop)).code, "state-conflict");
  const interrupt = {
    apiVersion: "runtime.sympoies.dev/v1", kind: "InterruptInstanceRequest",
    requestId: "interrupt-request", idempotencyKey: "interrupt-key", requestDigest: fixtures.ZERO_DIGEST,
    identity: subject.instanceIdentity, expectedState: "Running", runIdentity: "session-review",
  };
  interrupt.requestDigest = runtimeManager.computeSemanticRequestDigest(interrupt);
  const interrupted = await replacement.interrupt(interrupt);
  assert.equal(interrupted.kind, "InterruptInstanceSucceeded");
  const interruptedStop = { ...prematureStop, requestId: "stop-interrupted", idempotencyKey: "stop-interrupted" };
  interruptedStop.requestDigest = runtimeManager.computeSemanticRequestDigest(interruptedStop);
  assert.equal((await replacement.stop(interruptedStop)).code, "state-conflict");
  const drain = {
    apiVersion: "runtime.sympoies.dev/v1", kind: "DrainInstanceRequest",
    requestId: "drain-request", idempotencyKey: "drain-key", requestDigest: fixtures.ZERO_DIGEST,
    identity: subject.instanceIdentity, expectedState: "Interrupted",
    triggerFenceDigest: fixtures.ONE_DIGEST, publisherEpoch: "1", deadlinePolicyDigest: fixtures.TWO_DIGEST,
  };
  drain.requestDigest = runtimeManager.computeSemanticRequestDigest(drain);
  const drained = await replacement.drain(drain);
  assert.equal(drained.kind, "DrainInstanceSucceeded");
  const stop = {
    ...prematureStop,
    requestId: "stop-request",
    idempotencyKey: "stop-key",
    receiptChainHead: drained.receipt.digest,
  };
  stop.requestDigest = runtimeManager.computeSemanticRequestDigest(stop);
  assert.equal((await replacement.stop(stop)).kind, "StopInstanceSucceeded");

  const uncertainSubject = admittedFixture();
  const uncertainStore = runtimeKit.createMemoryRuntimeStore();
  const uncertain = managerFor(uncertainStore, {
    start: async () => ({ status: "indeterminate" }),
  });
  const uncertainLock = await uncertain.lock(uncertainSubject.request);
  const uncertainStart = assertionRequest(
    uncertainSubject, "start", uncertainLock.receipt.digest, "Locked",
  );
  assert.equal((await uncertain.start(uncertainStart)).kind, "StartInstanceIndeterminate");
  const control = createApplicationControlService({
    runtimeKit,
    manager: uncertain,
    peers: { controller: { operations: ["reconcile"], namespacePrefixes: ["review-service"] } },
    reconcileEvidence: async () => ({ status: "committed", sessionIdentity: "session-recovered" }),
  });
  const reconcile = {
    apiVersion: "runtime.sympoies.dev/v1", kind: "ReconcileInstanceRequest",
    requestId: "reconcile-start", originalOperation: "start",
    originalIdempotencyKey: uncertainStart.idempotencyKey,
    originalRequestDigest: uncertainStart.requestDigest,
    identity: uncertainSubject.instanceIdentity,
    journalEvidenceDigest: fixtures.ONE_DIGEST,
    dshEvidenceDigest: fixtures.TWO_DIGEST,
    expectedSourceStates: ["Locked"], expectedTerminalState: "Running",
  };
  const frame = runtimeManager.createManagerControlRequestFrame({ connectionNonce: "1", payload: reconcile });
  const response = await control.handle(frame, { peerIdentity: "controller" });
  assert.equal(response.payload.kind, "ReconcileInstanceProvedTerminal");
  assert.equal(response.payload.observedState, "Running");
  assert.equal(uncertain.reconcile, undefined);
});
