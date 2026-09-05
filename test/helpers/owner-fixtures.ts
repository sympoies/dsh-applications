import assert from "node:assert/strict";
import type {
  DigestAddressedSchemaOwner,
  InstanceIdentity,
  LockedAdmissionQuery,
  LockedPluginAdmission,
  PublicManagerOperation,
  RuntimeKitBoundary,
  RuntimeStore,
} from "../../packages/manager/src/index.ts";
import type { JsonValue, PluginDescriptor, Sha256Digest } from "../../packages/plugin-sdk/src/index.ts";

export const DIGEST = `sha256:${"1".repeat(64)}` as Sha256Digest;

type FixtureHandler = (...arguments_: any[]) => any;
type OwnerOverrides = Record<string, FixtureHandler | undefined>;
type OwnerCall = {
  owner: string;
  operation: string;
  request?: any;
  context?: any;
  options?: any;
  frame?: any;
  descriptor?: any;
};
type RawManager = Record<PublicManagerOperation | "reconcile", (request: unknown, context?: unknown) => Promise<any>>;

function record(value: unknown): Record<string, any> {
  assert(value !== null && typeof value === "object");
  return value as Record<string, any>;
}

export function identity(instanceId = "instance-a"): InstanceIdentity {
  const value = {
    deploymentId: "public-test",
    profileId: "review-bot",
    generationId: "generation-1",
    instanceId,
  };
  return { ...value, namespace: `${value.deploymentId}/${value.profileId}/${value.generationId}/${value.instanceId}` };
}

export function createOwnerRuntimeKit(overrides: OwnerOverrides = {}) {
  const calls: OwnerCall[] = [];
  const store: RuntimeStore = {
    instances: new Map<string, unknown>(),
    namespaces: new Map<string, unknown>(),
    journals: new Map<string, unknown>(),
    reconciliations: new Map<string, unknown>(),
    receipts: new Map<string, unknown>(),
    mutationLocks: new Map<string, unknown>(),
  };
  const rawManager = {} as RawManager;
  for (const operation of [
    "validate", "resolve", "lock", "start", "resume", "status",
    "interrupt", "drain", "stop", "doctor", "reconcile",
  ]) {
    rawManager[operation as keyof RawManager] = async (request: unknown, context?: unknown) => {
      calls.push({ owner: "manager", operation, request: structuredClone(request), context: structuredClone(context) });
      return overrides[operation]?.(request, context) ?? { owner: "runtime-kit", operation, request };
    };
  }
  const runtimeKit = {
    calls,
    store,
    rawManager,
    createMemoryRuntimeStore() {
      calls.push({ owner: "runtime-kit", operation: "create-store" });
      return store;
    },
    createCompositionService(options: unknown) {
      calls.push({ owner: "runtime-kit", operation: "create-composition", options });
      return { validate: rawManager.validate, resolve: rawManager.resolve };
    },
    createWorkloadManager(options: unknown) {
      const values = record(options);
      calls.push({ owner: "runtime-kit", operation: "create-manager", options });
      assert.equal(values.store, store);
      return rawManager;
    },
    createMediatedHostService(options: unknown) {
      const values = record(options);
      calls.push({ owner: "runtime-kit", operation: "create-host", options });
      assert.equal(values.store, store);
      return {
        journal: values.journal ?? new Map(),
        async execute(request: unknown) {
          calls.push({ owner: "host", operation: "execute", request: structuredClone(request) });
          return overrides.host?.(request) ?? { owner: "runtime-kit", kind: "MediatedHostActionSucceeded", request };
        },
      };
    },
    createManagerControlService(options: unknown) {
      const values = record(options);
      calls.push({ owner: "runtime-kit", operation: "create-control", options });
      return {
        async handle(frame: unknown, context: unknown) {
          const controlFrame = record(frame);
          calls.push({ owner: "control", operation: "handle", frame: structuredClone(frame), context: structuredClone(context) });
          if (controlFrame.operation === "instance.reconcile") {
            const evidence = await values.reconcileEvidence(controlFrame.payload, context);
            return values.manager.reconcile(controlFrame.payload, { authorized: true, evidence });
          }
          assert.equal(typeof controlFrame.operation, "string");
          const operation = controlFrame.operation.replace(/^instance\./, "");
          return values.manager[operation](controlFrame.payload);
        },
      };
    },
    validateMediatedHostActionRequest(request: unknown) {
      const candidate = record(request);
      calls.push({ owner: "runtime-kit", operation: "validate-host-request", request: structuredClone(request) });
      if (candidate.apiVersion !== "runtime.sympoies.dev/v1" || candidate.kind !== "MediatedHostActionRequest") {
        throw new TypeError("invalid mediated action");
      }
      if (candidate.runtimeAssertion?.valid !== true) throw new TypeError("runtime assertion rejected");
      return request;
    },
    validatePluginDescriptor(descriptor: unknown) {
      const candidate = record(descriptor);
      calls.push({ owner: "runtime-kit", operation: "validate-plugin-descriptor", descriptor: structuredClone(descriptor) });
      const expected = ["actions", "apiVersion", "artifact", "capabilities", "compatibility", "composition", "configuration", "health", "kind", "lifecycle", "mediation", "metadata"];
      if (candidate.apiVersion !== "runtime.sympoies.dev/v1" || candidate.kind !== "PluginDescriptor") throw new TypeError("invalid runtime-kit plugin descriptor");
      if (Object.keys(candidate).sort().join("\0") !== expected.join("\0")) throw new TypeError("plugin descriptor has unknown fields");
      return descriptor;
    },
    assertSecretFree(value: unknown, path = "document") {
      const visit = (candidate: unknown): void => {
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
  const checkedBoundary: RuntimeKitBoundary = runtimeKit;
  void checkedBoundary;
  return runtimeKit;
}

export function admitRunningPlugin(
  runtimeKit: ReturnType<typeof createOwnerRuntimeKit>,
  instanceIdentity: InstanceIdentity,
  descriptor: PluginDescriptor = pluginDescriptor(),
): { admissionResolver(query: LockedAdmissionQuery): LockedPluginAdmission; schemaOwner: DigestAddressedSchemaOwner } {
  runtimeKit.store.instances.set(instanceIdentity.namespace, {
    identity: structuredClone(instanceIdentity),
    state: "Running",
    receiptHead: DIGEST,
    resolvedCompositionDigest: DIGEST,
    compositionLockReceiptDigest: DIGEST,
    admissionSealDigest: DIGEST,
  });
  return {
    admissionResolver(query: LockedAdmissionQuery) {
      assert.deepEqual(query.identity, instanceIdentity);
      assert.equal(query.pluginId, descriptor.metadata.id);
      for (const field of ["resolvedCompositionDigest", "compositionLockReceiptDigest", "admissionSealDigest"] as const) {
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
          validate(value: unknown) {
            const candidate = value === null || typeof value !== "object" ? {} : value as Record<string, unknown>;
            if (context.direction === "input" && candidate.schemaInvalid === true) {
              throw new TypeError("plugin input schema rejected");
            }
            if (context.direction === "output" && candidate.schemaInvalid === true) {
              throw new TypeError("plugin output schema rejected");
            }
          },
        };
      },
    },
  };
}

export function pluginDescriptor(pluginId = "review"): PluginDescriptor {
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

export function hostAction(instanceIdentity: InstanceIdentity = identity(), overrides: Record<string, unknown> = {}): Record<string, any> {
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
