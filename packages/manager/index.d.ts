import type { JsonValue, PluginDescriptor, Sha256Digest } from "@sympoies/dsh-plugin-sdk";

export const PUBLIC_MANAGER_OPERATIONS: readonly ["validate", "resolve", "lock", "start", "resume", "status", "interrupt", "drain", "stop", "doctor"];
export const DEFAULT_PLUGIN_PAYLOAD_LIMITS: Readonly<PluginPayloadLimits>;

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

export function createApplicationManager(options: ApplicationManagerOptions): PublicApplicationManager;

export function createApplicationControlService(options: {
  runtimeKit: RuntimeKitBoundary;
  manager: PublicApplicationManager;
  peers: Record<string, { operations: string[]; namespacePrefixes: string[] }>;
  nonceHighWater?: Map<string, string>;
  reconcileEvidence(request: unknown, context: unknown): unknown | Promise<unknown>;
}): { handle(frame: unknown, context: unknown): Promise<unknown> };

export interface LockedAdmissionQuery {
  readonly identity: InstanceIdentity;
  readonly pluginId: string;
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

export function createPluginSandbox(options: {
  runtimeKit: RuntimeKitBoundary;
  manager: PublicApplicationManager;
  dshAdapter: ApplicationDshAdapter & { executePlugin(invocation: ApplicationPluginInvocation): Promise<JsonValue> };
  admissionResolver(query: LockedAdmissionQuery): LockedPluginAdmission | Promise<LockedPluginAdmission>;
  schemaOwner: DigestAddressedSchemaOwner;
  payloadLimits?: PluginPayloadLimits;
}): { invoke(request: PluginInvocation): Promise<JsonValue> };
