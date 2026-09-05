import assert from "node:assert/strict";

export const DIGEST = `sha256:${"1".repeat(64)}`;

export function identity(instanceId = "instance-a"): any {
  const value = {
    deploymentId: "public-test",
    profileId: "review-bot",
    generationId: "generation-1",
    instanceId,
  };
  return { ...value, namespace: `${value.deploymentId}/${value.profileId}/${value.generationId}/${value.instanceId}` };
}

export function createOwnerRuntimeKit(overrides: any = {}): any {
  const calls = [];
  const store = {
    instances: new Map(),
    namespaces: new Map(),
    journals: new Map(),
    reconciliations: new Map(),
    receipts: new Map(),
    mutationLocks: new Map(),
  };
  const rawManager: any = {};
  for (const operation of [
    "validate", "resolve", "lock", "start", "resume", "status",
    "interrupt", "drain", "stop", "doctor", "reconcile",
  ]) {
    rawManager[operation] = async (request, context) => {
      calls.push({ owner: "manager", operation, request: structuredClone(request), context: structuredClone(context) });
      return overrides[operation]?.(request, context) ?? { owner: "runtime-kit", operation, request };
    };
  }
  return {
    calls,
    store,
    rawManager,
    createMemoryRuntimeStore() {
      calls.push({ owner: "runtime-kit", operation: "create-store" });
      return store;
    },
    createCompositionService(options) {
      calls.push({ owner: "runtime-kit", operation: "create-composition", options });
      return { validate: rawManager.validate, resolve: rawManager.resolve };
    },
    createWorkloadManager(options) {
      calls.push({ owner: "runtime-kit", operation: "create-manager", options });
      assert.equal(options.store, store);
      return rawManager;
    },
    createMediatedHostService(options) {
      calls.push({ owner: "runtime-kit", operation: "create-host", options });
      assert.equal(options.store, store);
      return {
        journal: options.journal ?? new Map(),
        async execute(request) {
          calls.push({ owner: "host", operation: "execute", request: structuredClone(request) });
          return overrides.host?.(request) ?? { owner: "runtime-kit", kind: "MediatedHostActionSucceeded", request };
        },
      };
    },
    createManagerControlService(options) {
      calls.push({ owner: "runtime-kit", operation: "create-control", options });
      return {
        async handle(frame, context) {
          calls.push({ owner: "control", operation: "handle", frame: structuredClone(frame), context: structuredClone(context) });
          if (frame.operation === "instance.reconcile") {
            const evidence = await options.reconcileEvidence(frame.payload, context);
            return options.manager.reconcile(frame.payload, { authorized: true, evidence });
          }
          const operation = frame.operation.replace(/^instance\./, "");
          return options.manager[operation](frame.payload);
        },
      };
    },
    validateMediatedHostActionRequest(request) {
      calls.push({ owner: "runtime-kit", operation: "validate-host-request", request: structuredClone(request) });
      if (request?.apiVersion !== "runtime.sympoies.dev/v1" || request?.kind !== "MediatedHostActionRequest") {
        throw new TypeError("invalid mediated action");
      }
      if (request.runtimeAssertion?.valid !== true) throw new TypeError("runtime assertion rejected");
      return request;
    },
    validatePluginDescriptor(descriptor) {
      calls.push({ owner: "runtime-kit", operation: "validate-plugin-descriptor", descriptor: structuredClone(descriptor) });
      const expected = ["actions", "apiVersion", "artifact", "capabilities", "compatibility", "composition", "configuration", "health", "kind", "lifecycle", "mediation", "metadata"];
      if (descriptor?.apiVersion !== "runtime.sympoies.dev/v1" || descriptor?.kind !== "PluginDescriptor") throw new TypeError("invalid runtime-kit plugin descriptor");
      if (Object.keys(descriptor).sort().join("\0") !== expected.join("\0")) throw new TypeError("plugin descriptor has unknown fields");
      return descriptor;
    },
    assertSecretFree(value, path = "document") {
      const visit = candidate => {
        const tokenPrefixes = [["gh", "p_"].join(""), ["github", "_pat_"].join("")];
        const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
        if (typeof candidate === "string"
          && (tokenPrefixes.some(prefix => candidate.includes(prefix)) || candidate.includes(privateKeyMarker))) {
          throw new TypeError(`${path} contains secret material`);
        }
        if (candidate === null || typeof candidate !== "object") return;
        for (const [key, child] of Object.entries(candidate)) {
          if (/(?:secret|password|private.?key|access.?token|api.?token)/iu.test(key)) {
            throw new TypeError(`${path} contains a secret-shaped field`);
          }
          visit(child);
        }
      };
      visit(value);
      return value;
    },
  };
}

export function admitRunningPlugin(runtimeKit: any, instanceIdentity: any, descriptor: any = pluginDescriptor()): any {
  runtimeKit.store.instances.set(instanceIdentity.namespace, {
    identity: structuredClone(instanceIdentity),
    state: "Running",
    receiptHead: DIGEST,
    resolvedCompositionDigest: DIGEST,
    compositionLockReceiptDigest: DIGEST,
    admissionSealDigest: DIGEST,
  });
  return {
    admissionResolver(query) {
      assert.deepEqual(query.identity, instanceIdentity);
      assert.equal(query.pluginId, descriptor.metadata.id);
      for (const field of ["resolvedCompositionDigest", "compositionLockReceiptDigest", "admissionSealDigest"]) {
        assert.equal(query[field], DIGEST);
      }
      return {
        descriptor,
        descriptorDigest: descriptor.metadata.digest,
        artifactDigest: descriptor.artifact.digest,
        resolvedCompositionDigest: DIGEST,
        compositionLockReceiptDigest: DIGEST,
        admissionSealDigest: DIGEST,
      };
    },
    schemaOwner: {
      resolve(digest, context) {
        return {
          digest,
          validate(value) {
            if (context.direction === "input" && value?.schemaInvalid === true) {
              throw new TypeError("plugin input schema rejected");
            }
            if (context.direction === "output" && value?.schemaInvalid === true) {
              throw new TypeError("plugin output schema rejected");
            }
          },
        };
      },
    },
  };
}

export function pluginDescriptor(pluginId = "review"): any {
  return {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: { id: pluginId, version: "0.0.0", digest: DIGEST },
    artifact: {
      package: "@sympoies/review-plugin", digest: DIGEST, entrypoint: "dist/index.js",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      attestationIdentity: "https://github.com/sympoies/dsh-applications/actions@0123456789abcdef0123456789abcdef01234567",
    },
    compatibility: { dsh: "=0.1.1-rc.2", runtimeKit: "=0.0.0", pluginApi: "=1.0.0", platforms: ["linux-x64"] },
    capabilities: { provides: ["plugin.review"], requires: ["github.read"], tools: [], skills: [], services: [], dependencies: [] },
    actions: [{ id: "review.pull-request", class: "read", inputSchemaDigest: DIGEST, outputSchemaDigest: DIGEST, sideEffect: "none", idempotency: "supported", capability: "github.read" }],
    configuration: { schemaDigest: DIGEST, defaults: {} },
    mediation: { filesystem: [], network: ["github-api"], subprocess: [], resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65536 }, credentialHandleClasses: [] },
    health: { probes: [{ id: "review.ready", requirement: "required" }] },
    composition: { conflicts: [], cardinality: { min: 1, max: 1 }, namespaceClaims: ["plugin.review"], ordering: { before: [], after: [] } },
    lifecycle: { readiness: "required", interrupt: "supported", drain: "required", disposal: "required", recovery: "reconcile" },
  };
}

export function hostAction(instanceIdentity: any = identity(), overrides: any = {}): any {
  return {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "MediatedHostActionRequest",
    requestId: "action-request-1",
    identity: instanceIdentity,
    pluginDescriptorDigest: DIGEST,
    pluginId: "review",
    actionId: "review.pull-request",
    actionClass: "provider-read",
    inputSchemaDigest: DIGEST,
    outputSchemaDigest: DIGEST,
    payload: { pull: 7 },
    runtimeAssertion: {
      valid: true,
      operation: "host.action",
      requestDigest: DIGEST,
      pluginId: "review",
      instanceId: instanceIdentity.instanceId,
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
    actionNonce: "action-nonce-1",
    idempotencyKey: "action-key-1",
    requestDigest: DIGEST,
    runtimeAssertionDigest: DIGEST,
    ...overrides,
  };
}
