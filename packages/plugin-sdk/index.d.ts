export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
declare const sha256DigestBrand: unique symbol;
export type Sha256Digest = string & { readonly [sha256DigestBrand]: "sha256" };
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

type DeepExact<Candidate, Shape> = Candidate extends Shape
  ? Shape extends JsonPrimitive
    ? Candidate
    : Shape extends readonly (infer ShapeItem)[]
      ? Candidate extends readonly (infer CandidateItem)[]
        ? Candidate & readonly DeepExact<CandidateItem, ShapeItem>[]
        : never
      : Shape extends object
        ? Candidate extends object
          ? Exclude<keyof Candidate, keyof Shape> extends never
            ? Candidate & {
              readonly [Key in keyof Candidate]: Key extends keyof Shape
                ? DeepExact<Candidate[Key], Shape[Key]>
                : never;
            }
            : never
          : never
        : Candidate
  : never;

export function defineDigest(input: string): Sha256Digest;
export function defineTrigger<const T>(input: T & DeepExact<T, TriggerDescriptor>): Readonly<T>;
export function defineOutput<const T>(input: T & DeepExact<T, OutputDescriptor>): Readonly<T>;
export function defineConfiguration<const T>(input: T & DeepExact<T, ConfigurationDescriptor>): Readonly<T>;
export function defineHealth<const T>(input: T & DeepExact<T, HealthDescriptor>): Readonly<T>;
export function defineSandbox<const T>(input: T & DeepExact<T, SandboxDescriptor>): Readonly<T>;
export function definePlugin<const T>(runtimeKit: RuntimeKitPluginValidator, input: T & DeepExact<T, PluginDescriptor>): Readonly<T>;
