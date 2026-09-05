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

/** Untyped caller input after the object-shape check; every field is still validated. */
type Fields = Record<string, unknown>;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;

function fail(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Fields;
}

function exactKeys(value: Fields, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  }
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) fail(`${label} must be a stable public identifier`);
}

function digest(value: unknown, label: string): asserts value is Sha256Digest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) fail(`${label} must be a sha256 digest`);
}

export function defineDigest(input: string): Sha256Digest;
export function defineDigest(input: unknown): unknown {
  digest(input, "digest");
  return input;
}

function boundedArray(value: unknown, label: string, validate: (item: unknown, label: string) => void): unknown[] {
  if (!Array.isArray(value) || value.length > 1024) fail(`${label} must be a bounded array`);
  value.forEach((item, index) => validate(item, `${label}[${index}]`));
  return value;
}

function sortedIdentifiers(value: unknown, label: string): void {
  const items = boundedArray(value, label, identifier);
  if (new Set(items).size !== items.length || items.join("\0") !== [...items].sort().join("\0")) {
    fail(`${label} must be sorted and unique`);
  }
}

function positiveInteger(value: unknown, label: string, maximum: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${label} is out of range`);
  }
}

function assertJsonValue(value: unknown, label: string): void {
  const ancestors = new Set<object>();
  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) fail(`${label} must be lossless JSON`);
      return;
    }
    if (candidate === null || typeof candidate !== "object") fail(`${label} must be lossless JSON`);
    if (ancestors.has(candidate)) fail(`${label} must be lossless JSON`);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!isArray && prototype !== Object.prototype && prototype !== null)
      || (isArray && prototype !== Array.prototype)
      || Object.getOwnPropertySymbols(candidate).length !== 0) fail(`${label} must be lossless JSON`);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if (isArray) {
      const dataKeys = keys.filter(key => key !== "length");
      if (dataKeys.length !== (candidate as unknown[]).length) fail(`${label} must be lossless JSON`);
      for (let index = 0; index < dataKeys.length; index += 1) {
        if (dataKeys[index] !== String(index)) fail(`${label} must be lossless JSON`);
      }
    }
    ancestors.add(candidate);
    for (const key of keys) {
      if (isArray && key === "length") continue;
      const descriptor = descriptors[key] as PropertyDescriptor;
      if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
        fail(`${label} must be lossless JSON`);
      }
      visit(descriptor.value, `${path}.${key}`);
    }
    ancestors.delete(candidate);
  };
  visit(value, label);
}

function freezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = <Candidate>(candidate: Candidate): Candidate => {
    if (candidate !== null && typeof candidate === "object" && !Object.isFrozen(candidate)) {
      Object.values(candidate).forEach(freeze);
      Object.freeze(candidate);
    }
    return candidate;
  };
  return freeze(clone);
}

export function defineTrigger<const T>(input: T & DeepExact<T, TriggerDescriptor>): Readonly<T>;
export function defineTrigger(input: unknown): unknown {
  const trigger = record(input, "trigger");
  exactKeys(trigger, ["id", "class", "inputSchemaDigest"], [], "trigger");
  identifier(trigger.id, "trigger.id");
  if (!["manual", "event", "channel", "schedule"].includes(trigger.class as string)) fail("trigger.class is unsupported");
  digest(trigger.inputSchemaDigest, "trigger.inputSchemaDigest");
  return freezeClone(trigger);
}

export function defineOutput<const T>(input: T & DeepExact<T, OutputDescriptor>): Readonly<T>;
export function defineOutput(input: unknown): unknown {
  const output = record(input, "output");
  exactKeys(output, ["id", "schemaDigest"], [], "output");
  identifier(output.id, "output.id");
  digest(output.schemaDigest, "output.schemaDigest");
  return freezeClone(output);
}

export function defineConfiguration<const T>(input: T & DeepExact<T, ConfigurationDescriptor>): Readonly<T>;
export function defineConfiguration(input: unknown): unknown {
  const configuration = record(input, "configuration");
  exactKeys(configuration, ["schemaDigest", "defaults"], [], "configuration");
  digest(configuration.schemaDigest, "configuration.schemaDigest");
  assertJsonValue(configuration.defaults, "configuration.defaults");
  return freezeClone(configuration);
}

export function defineHealth<const T>(input: T & DeepExact<T, HealthDescriptor>): Readonly<T>;
export function defineHealth(input: unknown): unknown {
  const health = record(input, "health");
  exactKeys(health, ["probes"], [], "health");
  const probes = boundedArray(health.probes, "health.probes", (item, label) => {
    const probe = record(item, label);
    exactKeys(probe, ["id", "requirement"], [], label);
    identifier(probe.id, `${label}.id`);
    if (!["required", "optional"].includes(probe.requirement as string)) fail(`${label}.requirement is unsupported`);
  });
  if (new Set(probes.map(probe => (probe as Fields).id)).size !== probes.length) {
    fail("health.probes ids must be unique");
  }
  return freezeClone(health);
}

export function defineSandbox<const T>(input: T & DeepExact<T, SandboxDescriptor>): Readonly<T>;
export function defineSandbox(input: unknown): unknown {
  const sandbox = record(input, "sandbox");
  exactKeys(sandbox, [
    "filesystem", "network", "subprocess", "resources", "credentialHandleClasses",
  ], [], "sandbox");
  for (const field of ["filesystem", "network", "subprocess", "credentialHandleClasses"]) {
    sortedIdentifiers(sandbox[field], `sandbox.${field}`);
  }
  const resources = record(sandbox.resources, "sandbox.resources");
  exactKeys(resources, ["cpuClass", "memoryMb", "outputBytes"], [], "sandbox.resources");
  identifier(resources.cpuClass, "sandbox.resources.cpuClass");
  positiveInteger(resources.memoryMb, "sandbox.resources.memoryMb", 1_048_576);
  positiveInteger(resources.outputBytes, "sandbox.resources.outputBytes", 1_073_741_824);
  return freezeClone(sandbox);
}

export function definePlugin<const T>(runtimeKit: RuntimeKitPluginValidator, input: T & DeepExact<T, PluginDescriptor>): Readonly<T>;
export function definePlugin(runtimeKit: RuntimeKitPluginValidator, input: unknown): unknown {
  if (typeof runtimeKit?.validatePluginDescriptor !== "function") {
    fail("runtime-kit validatePluginDescriptor owner is required");
  }
  const validated = runtimeKit.validatePluginDescriptor(input);
  if (validated !== input) fail("runtime-kit descriptor validator returned a substituted document");
  return freezeClone(validated);
}
