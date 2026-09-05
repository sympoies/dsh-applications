import { Buffer } from "node:buffer";
import type { JsonValue, PluginDescriptor, Sha256Digest } from "@sympoies/dsh-plugin-sdk";

export const PUBLIC_MANAGER_OPERATIONS = Object.freeze([
  "validate", "resolve", "lock", "start", "resume", "status",
  "interrupt", "drain", "stop", "doctor",
] as const);

// Mirrors the runtime-kit host service's effectful action-class set: a
// descriptor action declared `read` may never carry one of these classes.
export const EFFECTFUL_HOST_ACTION_CLASSES: readonly string[] = Object.freeze([
  "filesystem-write", "network-connect", "subprocess-template",
  "provider-write", "credential-use",
]);

export type PublicManagerOperation = typeof PUBLIC_MANAGER_OPERATIONS[number];
export type PublicApplicationManager = Readonly<Record<PublicManagerOperation, (request: unknown) => Promise<unknown> | unknown>>;

export interface InstanceIdentity {
  readonly deploymentId: string;
  readonly profileId: string;
  readonly generationId: string;
  readonly instanceId: string;
  readonly namespace: string;
}

export interface RuntimeStore {
  readonly instances: Map<string, unknown>;
  readonly namespaces: Map<string, unknown>;
  readonly journals: Map<string, unknown>;
  readonly reconciliations: Map<string, unknown>;
  readonly receipts: Map<string, unknown>;
  readonly mutationLocks: Map<string, unknown>;
}

export interface ApplicationDshAdapter {
  readonly lifecycleEffects: Readonly<{
    start(request: unknown, context?: unknown): Promise<unknown> | unknown;
    resume(request: unknown, context?: unknown): Promise<unknown> | unknown;
    interrupt(request: unknown, context?: unknown): Promise<unknown> | unknown;
    drain(request: unknown, context?: unknown): Promise<unknown> | unknown;
    stop(request: unknown, context?: unknown): Promise<unknown> | unknown;
  }>;
}

export interface ApplicationPluginInvocation {
  readonly descriptor: PluginDescriptor;
  readonly actionId: string;
  readonly identity: InstanceIdentity;
  readonly input: JsonValue;
  readonly hostAction: (request: unknown) => Promise<unknown>;
}

export interface RuntimeKitBoundary {
  createMemoryRuntimeStore(): RuntimeStore;
  createCompositionService(options: unknown): unknown;
  createWorkloadManager(options: unknown): Record<PublicManagerOperation | "reconcile", (request: unknown, context?: unknown) => Promise<unknown> | unknown>;
  createMediatedHostService(options: unknown): { execute(request: unknown): Promise<unknown> };
  createManagerControlService(options: unknown): { handle(frame: unknown, context: unknown): Promise<unknown> };
  validateMediatedHostActionRequest(request: unknown): unknown;
  validatePluginDescriptor(descriptor: unknown): unknown;
  assertSecretFree(value: unknown, path?: string): unknown;
}

interface ApplicationManagerBaseOptions {
  runtimeKit: RuntimeKitBoundary;
  dshAdapter: ApplicationDshAdapter;
  composition?: unknown;
  trustVerifier: object;
  health(probe: string, context: unknown): unknown | Promise<unknown>;
  host?: {
    authorize?: (request: unknown) => unknown | Promise<unknown>;
    effect?: (request: unknown, context: unknown) => unknown | Promise<unknown>;
    broker?: (request: unknown, context: unknown) => unknown | Promise<unknown>;
    journal?: Map<string, unknown>;
  };
}

export type ApplicationManagerOptions = ApplicationManagerBaseOptions & (
  | { runtimeStore: RuntimeStore; allowEphemeralStore?: false }
  | { runtimeStore?: undefined; allowEphemeralStore: true }
);

export interface LockedAdmissionQuery {
  readonly identity: InstanceIdentity;
  readonly pluginId: string;
  readonly receiptChainHead: Sha256Digest;
  readonly resolvedCompositionDigest: Sha256Digest;
  readonly compositionLockReceiptDigest: Sha256Digest;
  readonly admissionSealDigest: Sha256Digest;
}

export interface LockedPluginAdmission {
  readonly descriptor: PluginDescriptor;
  readonly descriptorDigest: Sha256Digest;
  readonly artifactDigest: Sha256Digest;
  readonly resolvedCompositionDigest: Sha256Digest;
  readonly compositionLockReceiptDigest: Sha256Digest;
  readonly admissionSealDigest: Sha256Digest;
}

export interface DigestAddressedSchema {
  readonly digest: Sha256Digest;
  validate(value: unknown): void;
}

export interface DigestAddressedSchemaOwner {
  resolve(digest: Sha256Digest, context: {
    readonly direction: "input" | "output";
    readonly pluginId: string;
    readonly actionId: string;
  }): DigestAddressedSchema;
}

export interface PluginPayloadLimits {
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly depth: number;
  readonly items: number;
}

export interface PluginInvocation {
  readonly identity: InstanceIdentity;
  readonly pluginId: string;
  readonly actionId: string;
  readonly input: JsonValue;
}

export const DEFAULT_PLUGIN_PAYLOAD_LIMITS: Readonly<PluginPayloadLimits> = Object.freeze({
  inputBytes: 1_048_576,
  outputBytes: 1_048_576,
  depth: 32,
  items: 10_000,
});

const REQUIRED_RUNTIME_KIT = Object.freeze([
  "createMemoryRuntimeStore", "createCompositionService", "createWorkloadManager",
  "createMediatedHostService", "createManagerControlService",
  "validateMediatedHostActionRequest", "validatePluginDescriptor", "assertSecretFree",
] as const);
const IDENTITY_FIELDS = Object.freeze([
  "deploymentId", "profileId", "generationId", "instanceId", "namespace",
]);

/** Untyped caller input after the object-shape check; every field is still validated. */
type Fields = Record<string, unknown>;

/** Lifecycle evidence read back from the runtime-kit store for one locked instance. */
type LockedEvidence = Readonly<Pick<
  LockedAdmissionQuery,
  "receiptChainHead" | "resolvedCompositionDigest" | "compositionLockReceiptDigest" | "admissionSealDigest"
>>;

interface ManagerInternals {
  readonly rawManager: ReturnType<RuntimeKitBoundary["createWorkloadManager"]>;
  readonly store: RuntimeStore;
  readonly hostService: ReturnType<RuntimeKitBoundary["createMediatedHostService"]>;
  readonly dshAdapter: ApplicationDshAdapter;
  readonly runtimeKit: RuntimeKitBoundary;
}

const internals = new WeakMap<object, ManagerInternals>();

function fail(message: string): never {
  throw new TypeError(message);
}

function requireRuntimeKit(runtimeKit: RuntimeKitBoundary): void {
  for (const name of REQUIRED_RUNTIME_KIT) {
    if (typeof runtimeKit?.[name] !== "function") fail(`runtime-kit ${name} is required`);
  }
}

function canonicalIdentity(value: unknown, label = "instance identity"): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} is required`);
  const identity = value as Fields;
  if (Object.keys(identity).sort().join("\0") !== [...IDENTITY_FIELDS].sort().join("\0")) {
    fail(`${label} fields are invalid`);
  }
  for (const field of IDENTITY_FIELDS.slice(0, 4)) {
    if (typeof identity[field] !== "string" || identity[field].length === 0) fail(`${label}.${field} is required`);
  }
  const expected = `${identity.deploymentId}/${identity.profileId}/${identity.generationId}/${identity.instanceId}`;
  if (identity.namespace !== expected) fail(`${label}.namespace is not canonical`);
  return IDENTITY_FIELDS.map(field => identity[field]).join("\0");
}

function sameIdentity(left: unknown, right: unknown): boolean {
  try {
    return canonicalIdentity(left) === canonicalIdentity(right);
  } catch {
    return false;
  }
}

function normalizeLimits(value: unknown): Readonly<PluginPayloadLimits> {
  const candidate = value ?? DEFAULT_PLUGIN_PAYLOAD_LIMITS;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("plugin payload limits are invalid");
  }
  const limits = candidate as Fields;
  const expected = ["inputBytes", "outputBytes", "depth", "items"] as const;
  if (Object.keys(limits).sort().join("\0") !== [...expected].sort().join("\0")) {
    fail("plugin payload limits fields are invalid");
  }
  const maximums = { inputBytes: 16_777_216, outputBytes: 16_777_216, depth: 64, items: 100_000 };
  for (const field of expected) {
    const limit = limits[field];
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > maximums[field]) {
      fail(`plugin payload ${field} limit is invalid`);
    }
  }
  return Object.freeze({ ...limits }) as Readonly<PluginPayloadLimits>;
}

function jsonStringBytes(value: string, maximum: number, label: string): number {
  if (value.length > maximum) fail(`${label} exceeds its byte limit`);
  const encoded = JSON.stringify(value);
  const size = Buffer.byteLength(encoded, "utf8");
  if (size > maximum) fail(`${label} exceeds its byte limit`);
  return size;
}

interface BoundedJsonLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxItems: number;
}

/** Validate one lossless JSON graph and its amplification limits without cloning it. */
function assertBoundedJson(value: unknown, { maxBytes, maxDepth, maxItems }: BoundedJsonLimits, label: string): void {
  const ancestors = new Set<object>();
  let bytes = 0;
  let items = 0;
  const add = (amount: number): void => {
    bytes += amount;
    if (bytes > maxBytes) fail(`${label} exceeds its byte limit`);
  };
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > maxDepth) fail(`${label} exceeds its depth limit`);
    if (candidate === null) { add(4); return; }
    if (typeof candidate === "string") { add(jsonStringBytes(candidate, maxBytes - bytes, label)); return; }
    if (typeof candidate === "boolean") { add(candidate ? 4 : 5); return; }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) fail(`${label} must be lossless JSON`);
      add(Buffer.byteLength(JSON.stringify(candidate), "utf8"));
      return;
    }
    if (typeof candidate !== "object") fail(`${label} must be lossless JSON`);
    if (ancestors.has(candidate)) fail(`${label} must not contain cycles`);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!isArray && prototype !== Object.prototype && prototype !== null)
      || (isArray && prototype !== Array.prototype)) fail(`${label} must contain only JSON containers`);
    if (Object.getOwnPropertySymbols(candidate).length !== 0) fail(`${label} must not contain symbol fields`);
    if (isArray && (candidate as unknown[]).length > maxItems - items) fail(`${label} exceeds its item limit`);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if (isArray) {
      const dataKeys = keys.filter(key => key !== "length");
      if (dataKeys.length !== (candidate as unknown[]).length) fail(`${label} arrays must be dense`);
      for (let index = 0; index < dataKeys.length; index += 1) {
        if (dataKeys[index] !== String(index)) fail(`${label} arrays must be dense`);
      }
    }
    ancestors.add(candidate);
    add(2);
    let first = true;
    for (const key of keys) {
      if (isArray && key === "length") continue;
      const descriptor = descriptors[key] as PropertyDescriptor;
      if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
        fail(`${label} must contain only enumerable data fields`);
      }
      items += 1;
      if (items > maxItems) fail(`${label} exceeds its item limit`);
      if (!first) add(1);
      first = false;
      if (!isArray) {
        add(jsonStringBytes(key, maxBytes - bytes, label));
        add(1);
      }
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(candidate);
  };
  visit(value, 0);
}

function lockedInstanceEvidence(state: ManagerInternals, identity: InstanceIdentity): LockedEvidence {
  const instance = state.store.instances.get(identity.namespace) as Fields | undefined;
  if (instance === undefined || canonicalIdentity(instance.identity) !== canonicalIdentity(identity)) {
    fail("plugin instance is not locked by runtime-kit");
  }
  if (instance.state !== "Running") fail("plugin instance is not running");
  if (typeof instance.receiptHead !== "string" || instance.receiptHead.length === 0) {
    fail("plugin instance lifecycle receipt is unavailable");
  }
  return Object.freeze({
    receiptChainHead: instance.receiptHead,
    resolvedCompositionDigest: instance.resolvedCompositionDigest,
    compositionLockReceiptDigest: instance.compositionLockReceiptDigest,
    admissionSealDigest: instance.admissionSealDigest,
  }) as LockedEvidence;
}

function admittedDescriptor(
  resolution: unknown,
  locked: LockedEvidence,
  pluginId: string,
  runtimeKit: RuntimeKitBoundary,
): PluginDescriptor {
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) {
    fail("locked plugin admission could not be resolved");
  }
  const admission = resolution as Fields;
  const expected = [
    "descriptor", "descriptorDigest", "artifactDigest", "resolvedCompositionDigest",
    "compositionLockReceiptDigest", "admissionSealDigest",
  ];
  if (Object.keys(admission).sort().join("\0") !== [...expected].sort().join("\0")) {
    fail("locked plugin admission proof fields are invalid");
  }
  const descriptor = admission.descriptor as PluginDescriptor;
  runtimeKit.validatePluginDescriptor(descriptor);
  if (admission.resolvedCompositionDigest !== locked.resolvedCompositionDigest
    || admission.compositionLockReceiptDigest !== locked.compositionLockReceiptDigest
    || admission.admissionSealDigest !== locked.admissionSealDigest
    || admission.descriptorDigest !== descriptor.metadata.digest
    || admission.artifactDigest !== descriptor.artifact.digest
    || descriptor.metadata.id !== pluginId) fail("resolved plugin descriptor does not match locked admission");
  return descriptor;
}

function schemaFor(
  schemaOwner: DigestAddressedSchemaOwner,
  digest: Sha256Digest,
  context: Parameters<DigestAddressedSchemaOwner["resolve"]>[1],
): DigestAddressedSchema {
  if (typeof schemaOwner?.resolve !== "function") fail("digest-addressed schema owner is required");
  const schema = schemaOwner.resolve(digest, context);
  if (schema === null || typeof schema !== "object" || schema.digest !== digest
    || typeof schema.validate !== "function") fail("declared plugin schema is unavailable");
  return schema;
}

export function createApplicationManager(options: ApplicationManagerOptions): PublicApplicationManager;
export function createApplicationManager(options: ApplicationManagerOptions): unknown {
  requireRuntimeKit(options?.runtimeKit);
  if (options.dshAdapter === null || typeof options.dshAdapter !== "object") fail("DSH rc2 adapter is required");
  if (options.trustVerifier === null || typeof options.trustVerifier !== "object") fail("runtime-kit trust verifier is required");
  if (typeof options.health !== "function") fail("runtime health adapter is required");
  const runtimeKit = options.runtimeKit;
  const store = options.runtimeStore ?? (options.allowEphemeralStore === true
    ? runtimeKit.createMemoryRuntimeStore()
    : fail("an owner runtimeStore is required unless allowEphemeralStore is explicit"));
  const compositionService = runtimeKit.createCompositionService(options.composition ?? {});
  const rawManager = runtimeKit.createWorkloadManager({
    store,
    trustVerifier: options.trustVerifier,
    health: options.health,
    effects: options.dshAdapter.lifecycleEffects ?? {},
    compositionService,
  });
  const host: NonNullable<ApplicationManagerOptions["host"]> = options.host ?? {};
  const hostService = runtimeKit.createMediatedHostService({
    store,
    trustVerifier: options.trustVerifier,
    authorize: host.authorize ?? (async () => ({ allowed: false, admissionSealDigest: "" })),
    effect: host.effect,
    broker: host.broker,
    journal: host.journal,
  });
  const facade: Fields = {};
  for (const operation of PUBLIC_MANAGER_OPERATIONS) {
    if (typeof rawManager[operation] !== "function") fail(`runtime-kit manager operation ${operation} is required`);
    Object.defineProperty(facade, operation, {
      enumerable: true,
      value: (value: unknown) => rawManager[operation](value),
    });
  }
  Object.freeze(facade);
  internals.set(facade, { rawManager, store, hostService, dshAdapter: options.dshAdapter, runtimeKit });
  return facade;
}

export function createApplicationControlService(options: {
  runtimeKit: RuntimeKitBoundary;
  manager: PublicApplicationManager;
  peers: Record<string, { operations: string[]; namespacePrefixes: string[] }>;
  nonceHighWater?: Map<string, string>;
  reconcileEvidence(request: unknown, context: unknown): unknown | Promise<unknown>;
}): { handle(frame: unknown, context: unknown): Promise<unknown> };
export function createApplicationControlService({ runtimeKit, manager, peers, nonceHighWater, reconcileEvidence }: {
  runtimeKit: RuntimeKitBoundary;
  manager: PublicApplicationManager;
  peers: unknown;
  nonceHighWater?: unknown;
  reconcileEvidence: unknown;
}): unknown {
  requireRuntimeKit(runtimeKit);
  const state = internals.get(manager);
  if (state === undefined || state.runtimeKit !== runtimeKit) fail("manager was not created by this runtime-kit boundary");
  if (typeof reconcileEvidence !== "function") fail("authenticated reconcile evidence resolver is required");
  return runtimeKit.createManagerControlService({
    manager: state.rawManager,
    peers,
    nonceHighWater,
    reconcileEvidence,
  });
}

export function createPluginSandbox(options: {
  runtimeKit: RuntimeKitBoundary;
  manager: PublicApplicationManager;
  dshAdapter: ApplicationDshAdapter & { executePlugin(invocation: ApplicationPluginInvocation): Promise<JsonValue> };
  admissionResolver(query: LockedAdmissionQuery): LockedPluginAdmission | Promise<LockedPluginAdmission>;
  schemaOwner: DigestAddressedSchemaOwner;
  payloadLimits?: PluginPayloadLimits;
}): { invoke(request: PluginInvocation): Promise<JsonValue> };
export function createPluginSandbox({
  runtimeKit, manager, dshAdapter, admissionResolver, schemaOwner, payloadLimits,
}: {
  runtimeKit: RuntimeKitBoundary;
  manager: PublicApplicationManager;
  dshAdapter: ApplicationDshAdapter & { executePlugin(invocation: ApplicationPluginInvocation): Promise<JsonValue> };
  admissionResolver(query: LockedAdmissionQuery): LockedPluginAdmission | Promise<LockedPluginAdmission>;
  schemaOwner: DigestAddressedSchemaOwner;
  payloadLimits?: unknown;
}): unknown {
  requireRuntimeKit(runtimeKit);
  const state = internals.get(manager);
  if (state === undefined || state.runtimeKit !== runtimeKit || state.dshAdapter !== dshAdapter) {
    fail("plugin sandbox manager binding is invalid");
  }
  if (typeof dshAdapter.executePlugin !== "function") fail("DSH plugin execution adapter is required");
  if (typeof admissionResolver !== "function") fail("locked plugin admission resolver is required");
  const configuredLimits = normalizeLimits(payloadLimits);
  const invoke = async (value: unknown): Promise<JsonValue> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail("plugin invocation is required");
    if (Object.keys(value).sort().join("\0") !== ["actionId", "identity", "input", "pluginId"].sort().join("\0")) {
      fail("plugin invocation fields are invalid");
    }
    const request = value as Fields;
    canonicalIdentity(request.identity, "plugin instance identity");
    if (typeof request.pluginId !== "string" || request.pluginId.length === 0) fail("plugin id is required");
    if (typeof request.actionId !== "string" || request.actionId.length === 0) fail("plugin action id is required");
    const pluginId = request.pluginId;
    const actionId = request.actionId;
    const identity = request.identity as InstanceIdentity;
    const locked = lockedInstanceEvidence(state, identity);
    assertBoundedJson(request.input, {
      maxBytes: configuredLimits.inputBytes,
      maxDepth: configuredLimits.depth,
      maxItems: configuredLimits.items,
    }, "plugin input");
    runtimeKit.assertSecretFree(request.input, "plugin input");
    const detachedIdentity = structuredClone(identity);
    const detachedInput = structuredClone(request.input) as JsonValue;
    const resolution = await admissionResolver(Object.freeze({
      identity: structuredClone(detachedIdentity),
      pluginId,
      ...locked,
    }));
    const current = lockedInstanceEvidence(state, detachedIdentity);
    for (const field of [
      "receiptChainHead", "resolvedCompositionDigest", "compositionLockReceiptDigest", "admissionSealDigest",
    ] as const) if (current[field] !== locked[field]) fail("locked plugin admission changed during resolution");
    const admitted = admittedDescriptor(resolution, current, pluginId, runtimeKit);
    const descriptor = structuredClone(admitted);
    runtimeKit.validatePluginDescriptor(descriptor);
    const action = descriptor.actions.find(candidate => candidate.id === actionId);
    if (action === undefined) fail("plugin action is not declared by the locked descriptor");
    const inputSchema = schemaFor(schemaOwner, action.inputSchemaDigest, {
      direction: "input", pluginId, actionId: action.id,
    });
    inputSchema.validate(structuredClone(detachedInput));
    const detachedDescriptor = structuredClone(descriptor);
    let invocationActive = true;
    const hostAction = async (request: unknown): Promise<unknown> => {
      if (!invocationActive) fail("mediated host capability is no longer active");
      assertBoundedJson(request, {
        maxBytes: configuredLimits.inputBytes,
        maxDepth: configuredLimits.depth,
        maxItems: configuredLimits.items,
      }, "mediated host request");
      const detachedRequest = structuredClone(request) as Fields;
      if (!sameIdentity(detachedRequest?.identity, detachedIdentity)) fail("mediated action identity does not match plugin instance");
      if (detachedRequest.pluginId !== descriptor.metadata.id) fail("mediated action plugin does not match descriptor");
      if (detachedRequest.actionId !== action.id) fail("mediated action does not match plugin action");
      if (detachedRequest.pluginDescriptorDigest !== descriptor.metadata.digest) fail("mediated action descriptor digest does not match plugin");
      if (detachedRequest.inputSchemaDigest !== action.inputSchemaDigest || detachedRequest.outputSchemaDigest !== action.outputSchemaDigest) {
        fail("mediated action schemas do not match plugin action");
      }
      if (action.class === "read" && EFFECTFUL_HOST_ACTION_CLASSES.includes(detachedRequest.actionClass as string)) {
        fail("mediated action class escalates past the declared read action");
      }
      runtimeKit.validateMediatedHostActionRequest(detachedRequest);
      return state.hostService.execute(detachedRequest);
    };
    let output: unknown;
    try {
      output = await dshAdapter.executePlugin(Object.freeze({
        descriptor: detachedDescriptor,
        actionId: action.id,
        identity: detachedIdentity,
        input: detachedInput,
        hostAction,
      }));
    } finally {
      invocationActive = false;
    }
    assertBoundedJson(output, {
      maxBytes: Math.min(configuredLimits.outputBytes, descriptor.mediation.resources.outputBytes),
      maxDepth: configuredLimits.depth,
      maxItems: configuredLimits.items,
    }, "plugin output");
    const detachedOutput = structuredClone(output) as JsonValue;
    const outputSchema = schemaFor(schemaOwner, action.outputSchemaDigest, {
      direction: "output", pluginId, actionId: action.id,
    });
    outputSchema.validate(structuredClone(detachedOutput));
    runtimeKit.assertSecretFree(detachedOutput, "plugin output");
    return detachedOutput;
  };
  return Object.freeze({ invoke });
}
