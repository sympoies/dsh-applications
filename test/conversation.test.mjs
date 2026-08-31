import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createApplicationManager, createPluginSandbox } from "../packages/manager/src/index.js";
import { REQUIRED_AMBIENT_DENIALS } from "../packages/dsh-rc2-adapter/src/index.js";
import { createAdapterHarness } from "./helpers/adapter-harness.mjs";
import {
  DIGEST,
  admitRunningPlugin,
  createOwnerRuntimeKit,
  pluginDescriptor,
} from "./helpers/owner-fixtures.mjs";

const profile = JSON.parse(
  readFileSync(new URL("../profiles/conversational/profile.json", import.meta.url), "utf8"),
);

function conversationIdentity(instanceId = "channel-a") {
  const value = {
    deploymentId: "conversation-service",
    profileId: "conversational",
    generationId: "generation-1",
    instanceId,
  };
  return {
    ...value,
    namespace: `${value.deploymentId}/${value.profileId}/${value.generationId}/${value.instanceId}`,
  };
}

function codingIdentity(instanceId = "project-a") {
  const value = {
    deploymentId: "coding-service",
    profileId: "coding",
    generationId: "generation-1",
    instanceId,
  };
  return {
    ...value,
    namespace: `${value.deploymentId}/${value.profileId}/${value.generationId}/${value.instanceId}`,
  };
}

// The one separately granted read-only action: it is deliberately absent from
// the profile's default grants and becomes available only through a locked
// plugin admission that declares it.
function conversationDescriptor() {
  const descriptor = pluginDescriptor("conversation-agent");
  descriptor.artifact.package = "@sympoies/conversation-agent";
  descriptor.capabilities = {
    provides: ["plugin.conversation"],
    requires: ["conversation.lookup"],
    tools: [], skills: [], services: [], dependencies: [],
  };
  descriptor.actions = [{
    id: "conversation.lookup",
    class: "read",
    inputSchemaDigest: DIGEST,
    outputSchemaDigest: DIGEST,
    sideEffect: "none",
    idempotency: "supported",
    capability: "conversation.lookup",
  }];
  descriptor.mediation = {
    filesystem: [], network: [], subprocess: [],
    resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65536 },
    credentialHandleClasses: [],
  };
  descriptor.composition = {
    conflicts: [], cardinality: { min: 1, max: 1 },
    namespaceClaims: ["plugin.conversation"], ordering: { before: [], after: [] },
  };
  descriptor.health = { probes: [{ id: "conversation-agent.ready", requirement: "required" }] };
  return descriptor;
}

test("the conversational profile carries no repository, shell, workspace, or ambient network authority", () => {
  assert.equal(profile.workload.class, "conversational-service");
  assert.equal(profile.workload.scopeClass, "non-project");
  assert.deepEqual([...profile.grants].sort(), ["conversation.memory", "conversation.reply"]);
  for (const grant of profile.grants) {
    assert.doesNotMatch(grant, /coding|repository|shell|workspace|network|publish|review/u);
  }
  assert.deepEqual(profile.limits.networkClasses, [], "no ambient network class");
  assert.deepEqual(profile.limits.workspaceClasses, [], "no workspace class");
  assert.equal(profile.state.workspace, "none", "no project or dummy repository");
  assert.equal(profile.state.session, "persistent");
  assert.equal(profile.state.restart, "resume");
  assert.deepEqual(
    [...profile.approvals.requiredFor].sort(),
    ["destructive", "open-world"],
  );
  assert.deepEqual(profile.triggers.map(trigger => trigger.class), ["message"]);
  for (const denial of ["env", "filesystem", "network", "subprocess", "credential", "secret", "cross-instance"]) {
    assert(REQUIRED_AMBIENT_DENIALS.includes(denial), `ambient ${denial} denial is required`);
  }
});

test("a conversation instance denies ambient tools, persists across restart, and resumes only its own session", async () => {
  const subject = createAdapterHarness();
  const channel = conversationIdentity();
  const started = await subject.adapter.lifecycleEffects.start({ identity: channel });
  assert.equal(started.status, "succeeded");
  const sessionId = started.sessionIdentity;

  // Shell and every other ambient tool surface is closed: the scope allows no
  // ambient tools, and the DSH guard denies non-plugin executions.
  assert.deepEqual(subject.restrictions.at(-1), { allow: [] });
  const guard = subject.guards.at(-1);
  for (const ambient of ["bash", "shell_exec", "repository_read", "http_fetch"]) {
    assert.notEqual(
      guard({ name: ambient, arguments: {} }),
      undefined,
      `${ambient} must be denied for a conversation-scoped agent`,
    );
  }

  // Restart persistence: stop the instance, then cold-resume the same
  // channel; the adapter must reopen the persisted session by point lookup.
  await subject.adapter.lifecycleEffects.interrupt({ identity: channel });
  await subject.adapter.lifecycleEffects.drain({ identity: channel });
  await subject.adapter.lifecycleEffects.stop({ identity: channel });
  assert.equal(subject.handles.has(sessionId), false, "stop disposes the live agent");
  const resumed = await subject.adapter.lifecycleEffects.resume({ identity: channel });
  assert.equal(resumed.status, "succeeded");
  assert.equal(subject.resumed.at(-1).resumeSessionId, sessionId, "resume reopens the persisted session");
  assert.deepEqual(subject.inspectCalls, [sessionId], "cold resume is a point lookup, never a scan");
});

test("conversation state, queues, and credential namespaces stay isolated from other profiles", async () => {
  const subject = createAdapterHarness();
  const channel = conversationIdentity();
  const project = codingIdentity();
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: channel })).status, "succeeded");
  assert.equal((await subject.adapter.lifecycleEffects.start({ identity: project })).status, "succeeded");
  const conversationRuntime = subject.runtimes.get(channel.namespace);
  const codingRuntime = subject.runtimes.get(project.namespace);
  assert.notEqual(conversationRuntime.root, codingRuntime.root, "session roots are disjoint");
  assert.notEqual(conversationRuntime.sessionId, codingRuntime.sessionId);
  for (const field of ["memory", "queue", "credentialHandles", "budget", "concurrencyController"]) {
    assert.notDeepEqual(
      conversationRuntime[field],
      codingRuntime[field],
      `${field} namespace must not be shared across profiles`,
    );
  }
  // A conversation resume can never adopt the coding profile's session: the
  // persisted roots differ, and the adapter requires the identity's own root.
  assert.notEqual(
    subject.persisted.get(conversationRuntime.sessionId),
    subject.persisted.get(codingRuntime.sessionId),
  );

  // The isolation is enforced by the production adapter, not by fixture
  // string shapes: a coding runtime that tries to reuse ANY of the running
  // conversation instance's reserved controllers is refused before create.
  for (const field of ["memory", "queue", "credentialHandles", "budget", "concurrencyController", "root", "sessionId"]) {
    let conversationRuntimeValue;
    const sharing = createAdapterHarness({
      runtimeFactory(instanceIdentity, runtimes) {
        const runtime = sharing.defaultRuntime(instanceIdentity);
        if (instanceIdentity.profileId === "conversational") conversationRuntimeValue = runtime;
        if (instanceIdentity.profileId === "coding") runtime[field] = conversationRuntimeValue[field];
        return runtime;
      },
    });
    assert.equal(
      (await sharing.adapter.lifecycleEffects.start({ identity: conversationIdentity() })).status,
      "succeeded", field,
    );
    assert.deepEqual(
      await sharing.adapter.lifecycleEffects.start({ identity: codingIdentity() }),
      { status: "failed", code: "runtime-unavailable" },
      `sharing the conversation ${field} across profiles must be refused`,
    );
    assert.equal(sharing.created.length, 1, `${field} sharing must fail before agent creation`);
  }
});

test("one separately granted read-only action is admitted while undeclared and mismatched actions fail closed", async () => {
  const runtimeKit = createOwnerRuntimeKit();
  const channel = conversationIdentity();
  const descriptor = conversationDescriptor();
  const executions = [];
  const dshAdapter = {
    lifecycleEffects: {},
    async executePlugin(invocationValue) {
      executions.push(invocationValue.actionId);
      const reply = await invocationValue.hostAction({
        apiVersion: "runtime.sympoies.dev/v1",
        kind: "MediatedHostActionRequest",
        requestId: "conversation-lookup-1",
        identity: invocationValue.identity,
        pluginDescriptorDigest: invocationValue.descriptor.metadata.digest,
        pluginId: "conversation-agent",
        actionId: "conversation.lookup",
        actionClass: "provider-read",
        inputSchemaDigest: DIGEST,
        outputSchemaDigest: DIGEST,
        payload: structuredClone(invocationValue.input),
        runtimeAssertion: {
          valid: true,
          operation: "host.action",
          requestDigest: DIGEST,
          pluginId: "conversation-agent",
          instanceId: invocationValue.identity.instanceId,
          targetScopeDigest: DIGEST,
          resourceClass: "shared",
          budgetUnits: "1",
          publisherEpoch: "1",
          expectedState: "Running",
        },
        expectedState: "Running",
        targetScopeDigest: DIGEST,
        resourceClass: "shared",
        budgetDebit: { units: "1" },
        publisherEpoch: "1",
        actionNonce: "conversation-nonce-1",
        idempotencyKey: "conversation-key-1",
        requestDigest: DIGEST,
        runtimeAssertionDigest: DIGEST,
      });
      return { reply };
    },
  };
  const manager = createApplicationManager({
    runtimeKit,
    runtimeStore: runtimeKit.store,
    dshAdapter,
    composition: {},
    trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
  });
  const admission = admitRunningPlugin(runtimeKit, channel, descriptor);
  const sandbox = createPluginSandbox({ runtimeKit, manager, dshAdapter, ...admission });

  const output = await sandbox.invoke({
    pluginId: "conversation-agent",
    actionId: "conversation.lookup",
    identity: channel,
    input: { message: "when is the next maintenance window?" },
  });
  assert.equal(output.reply.kind, "MediatedHostActionSucceeded");
  assert.deepEqual(executions, ["conversation.lookup"]);

  // An action the locked descriptor never declared - a write - fails closed
  // before any DSH execution.
  await assert.rejects(
    sandbox.invoke({
      pluginId: "conversation-agent",
      actionId: "conversation.send",
      identity: channel,
      input: { message: "write attempt" },
    }),
    /not declared/u,
  );
  assert.deepEqual(executions, ["conversation.lookup"], "the undeclared action never reached DSH");

  // A mediated request that tries to escalate past the declared read action
  // fails the manager's action binding.
  const escalatingAdapter = {
    ...dshAdapter,
    async executePlugin(invocationValue) {
      return invocationValue.hostAction({
        apiVersion: "runtime.sympoies.dev/v1",
        kind: "MediatedHostActionRequest",
        requestId: "conversation-escalate-1",
        identity: invocationValue.identity,
        pluginDescriptorDigest: invocationValue.descriptor.metadata.digest,
        pluginId: "conversation-agent",
        actionId: "repository.write",
        actionClass: "provider-write",
        inputSchemaDigest: DIGEST,
        outputSchemaDigest: DIGEST,
        payload: {},
        runtimeAssertion: { valid: true },
        expectedState: "Running",
        targetScopeDigest: DIGEST,
        resourceClass: "shared",
        budgetDebit: { units: "1" },
        publisherEpoch: "1",
        actionNonce: "conversation-nonce-2",
        idempotencyKey: "conversation-key-2",
        requestDigest: DIGEST,
        runtimeAssertionDigest: DIGEST,
      });
    },
  };
  const escalatingManager = createApplicationManager({
    runtimeKit,
    runtimeStore: runtimeKit.store,
    dshAdapter: escalatingAdapter,
    composition: {},
    trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
  });
  const escalatingSandbox = createPluginSandbox({
    runtimeKit, manager: escalatingManager, dshAdapter: escalatingAdapter, ...admission,
  });
  await assert.rejects(
    escalatingSandbox.invoke({
      pluginId: "conversation-agent",
      actionId: "conversation.lookup",
      identity: channel,
      input: { message: "escalate" },
    }),
    /mediated action does not match plugin action/u,
  );

  // Class escalation with the CORRECT declared actionId also fails closed:
  // a read-declared action can never carry an effectful host action class.
  const classEscalatingAdapter = {
    ...dshAdapter,
    async executePlugin(invocationValue) {
      return invocationValue.hostAction({
        apiVersion: "runtime.sympoies.dev/v1",
        kind: "MediatedHostActionRequest",
        requestId: "conversation-class-escalate-1",
        identity: invocationValue.identity,
        pluginDescriptorDigest: invocationValue.descriptor.metadata.digest,
        pluginId: "conversation-agent",
        actionId: "conversation.lookup",
        actionClass: "provider-write",
        inputSchemaDigest: DIGEST,
        outputSchemaDigest: DIGEST,
        payload: {},
        runtimeAssertion: { valid: true },
        expectedState: "Running",
        targetScopeDigest: DIGEST,
        resourceClass: "shared",
        budgetDebit: { units: "1" },
        publisherEpoch: "1",
        actionNonce: "conversation-nonce-3",
        idempotencyKey: "conversation-key-3",
        requestDigest: DIGEST,
        runtimeAssertionDigest: DIGEST,
      });
    },
  };
  const classEscalatingManager = createApplicationManager({
    runtimeKit,
    runtimeStore: runtimeKit.store,
    dshAdapter: classEscalatingAdapter,
    composition: {},
    trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
  });
  const classEscalatingSandbox = createPluginSandbox({
    runtimeKit, manager: classEscalatingManager, dshAdapter: classEscalatingAdapter, ...admission,
  });
  await assert.rejects(
    classEscalatingSandbox.invoke({
      pluginId: "conversation-agent",
      actionId: "conversation.lookup",
      identity: channel,
      input: { message: "class escalate" },
    }),
    /escalates past the declared read action/u,
  );

  // Conversation outputs stay secret-free.
  assert.throws(
    () => runtimeKit.assertSecretFree({ accessToken: "leak" }, "conversation output"),
    /secret-shaped/u,
  );
});

const exactRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactAvailable = existsSync(join(exactRoot, "src/manager/index.js"));

test("exact runtime-kit retains the conversation instance across manager restarts", { skip: !exactAvailable }, async () => {
  const composition = await import(pathToFileURL(join(exactRoot, "src/composition/index.js")));
  const runtimeManager = await import(pathToFileURL(join(exactRoot, "src/manager/index.js")));
  const fixtures = await import(pathToFileURL(join(exactRoot, "test/helpers/manager-fixtures.mjs")));
  const runtimeKit = { ...composition, ...runtimeManager };

  const resolved = fixtures.composition("non-project");
  const lock = fixtures.compositionLock(resolved);
  const channel = fixtures.identity({
    deploymentId: "conversation-service",
    profileId: "conversational",
    instanceId: "channel-a",
  });
  const signing = fixtures.signingFixture();
  const bundle = fixtures.trustBundle(signing);
  const seal = fixtures.admissionSeal(resolved, lock, channel, signing, bundle);
  const request = fixtures.baseLockRequest(resolved, lock, channel, seal);
  request.requestDigest = runtimeManager.computeSemanticRequestDigest(request);
  request.runtimeAssertion = fixtures.runtimeAssertion(
    seal, channel, signing, bundle, "lock", request.requestDigest,
  );
  request.runtimeAssertionDigest = request.runtimeAssertion.metadata.digest;

  function managerFor(store) {
    return createApplicationManager({
      runtimeKit,
      runtimeStore: store,
      dshAdapter: {
        lifecycleEffects: {
          start: async () => ({ status: "succeeded", sessionIdentity: "session-channel-a" }),
        },
      },
      composition: {
        validatorVersion: "1.0.0",
        resolverVersion: "1.0.0",
        resolvePublicPolicy() { return null; },
      },
      trustVerifier: fixtures.acceptingTrustVerifier(),
      health: async () => ({ state: "ready", code: "READY" }),
    });
  }

  const store = runtimeKit.createMemoryRuntimeStore();
  const first = managerFor(store);
  const locked = await first.lock(request);
  assert.equal(locked.kind, "LockInstanceSucceeded");

  const startRequest = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "StartInstanceRequest",
    requestId: "conversation-start",
    idempotencyKey: "conversation-start-key",
    requestDigest: fixtures.ZERO_DIGEST,
    identity: structuredClone(channel),
    priorReceiptDigest: locked.receipt.digest,
    admissionSealDigest: seal.metadata.digest,
    runtimeAssertion: null,
    runtimeAssertionDigest: null,
    expectedState: "Locked",
  };
  startRequest.requestDigest = runtimeManager.computeSemanticRequestDigest(startRequest);
  startRequest.runtimeAssertion = fixtures.runtimeAssertion(
    seal, channel, signing, bundle, "start", startRequest.requestDigest,
  );
  startRequest.runtimeAssertionDigest = startRequest.runtimeAssertion.metadata.digest;
  const started = await first.start(startRequest);
  assert.equal(started.kind, "StartInstanceSucceeded");

  // A brand-new manager over the same owner store observes the running
  // conversation instance: session truth survives the restart boundary.
  const replacement = managerFor(store);
  const status = await replacement.status({
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "StatusInstanceRequest",
    requestId: "conversation-restart-status",
    identity: structuredClone(channel),
    receiptChainHead: started.receipt.digest,
  });
  assert.equal(status.observedState, "Running");

  // Another profile's namespace shares nothing with this channel.
  const foreign = await replacement.status({
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "StatusInstanceRequest",
    requestId: "conversation-foreign-status",
    identity: fixtures.identity({
      deploymentId: "coding-service",
      profileId: "coding",
      instanceId: "project-a",
    }),
    receiptChainHead: started.receipt.digest,
  });
  assert.equal(foreign.kind, "StatusInstanceFailed", "a foreign namespace never observes this channel's state");
  assert.equal(foreign.code, "not-found");
  assert.equal(foreign.observedState, null);
});
