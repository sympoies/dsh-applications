export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type Sha256Digest = `sha256:${string}`;
export type TriggerClass = "manual" | "event" | "channel" | "schedule";

export interface TriggerDescriptor {
  readonly id: string;
  readonly class: TriggerClass;
  readonly inputSchemaDigest: Sha256Digest;
}

export interface OutputDescriptor {
  readonly id: string;
  readonly schemaDigest: Sha256Digest;
}

export interface ConfigurationDescriptor {
  readonly schemaDigest: Sha256Digest;
  readonly defaults: JsonValue;
}

export interface HealthProbeDescriptor {
  readonly id: string;
  readonly requirement: "required" | "optional";
}

export interface HealthDescriptor {
  readonly probes: readonly HealthProbeDescriptor[];
}

export interface SandboxDescriptor {
  readonly filesystem: readonly string[];
  readonly network: readonly string[];
  readonly subprocess: readonly string[];
  readonly credentialHandleClasses: readonly string[];
  readonly resources: {
    readonly cpuClass: string;
    readonly memoryMb: number;
    readonly outputBytes: number;
  };
}

export interface PluginActionDescriptor {
  readonly id: string;
  readonly class: "read" | "write" | "destructive" | "open-world";
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly sideEffect: "none" | "idempotent" | "non-idempotent";
  readonly idempotency: "none" | "supported" | "required";
  readonly capability: string;
}

export interface PluginDescriptor {
  readonly apiVersion: "runtime.sympoies.dev/v1";
  readonly kind: "PluginDescriptor";
  readonly metadata: { readonly id: string; readonly version: string; readonly digest: Sha256Digest };
  readonly artifact: {
    readonly package: string;
    readonly digest: Sha256Digest;
    readonly entrypoint: string;
    readonly sourceRevision: string;
    readonly attestationIdentity: string;
  };
  readonly compatibility: {
    readonly dsh: string;
    readonly runtimeKit: string;
    readonly pluginApi: string;
    readonly platforms: readonly string[];
  };
  readonly capabilities: {
    readonly provides: readonly string[];
    readonly requires: readonly string[];
    readonly tools: readonly string[];
    readonly skills: readonly string[];
    readonly services: readonly string[];
    readonly dependencies: readonly {
      readonly id: string;
      readonly range: string;
      readonly scope: "required" | "optional";
    }[];
  };
  readonly actions: readonly PluginActionDescriptor[];
  readonly configuration: ConfigurationDescriptor;
  readonly mediation: SandboxDescriptor;
  readonly health: HealthDescriptor;
  readonly composition: {
    readonly conflicts: readonly string[];
    readonly cardinality: { readonly min: number; readonly max: number };
    readonly namespaceClaims: readonly string[];
    readonly ordering: { readonly before: readonly string[]; readonly after: readonly string[] };
  };
  readonly lifecycle: {
    readonly readiness: "required" | "optional";
    readonly interrupt: "supported" | "unsupported";
    readonly drain: "required" | "unsupported";
    readonly disposal: "required";
    readonly recovery: "reconcile" | "restart" | "unsupported";
  };
}

export interface RuntimeKitPluginValidator {
  validatePluginDescriptor(value: unknown): unknown;
}

export function defineTrigger<const T extends TriggerDescriptor>(input: T): Readonly<T>;
export function defineOutput<const T extends OutputDescriptor>(input: T): Readonly<T>;
export function defineConfiguration<const T extends ConfigurationDescriptor>(input: T): Readonly<T>;
export function defineHealth<const T extends HealthDescriptor>(input: T): Readonly<T>;
export function defineSandbox<const T extends SandboxDescriptor>(input: T): Readonly<T>;
export function definePlugin<const T extends PluginDescriptor>(runtimeKit: RuntimeKitPluginValidator, input: T): Readonly<T>;
