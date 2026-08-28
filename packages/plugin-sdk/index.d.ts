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

export function defineTrigger<const T extends TriggerDescriptor>(input: T): Readonly<T>;
export function defineOutput<const T extends OutputDescriptor>(input: T): Readonly<T>;
export function definePlugin<const T>(runtimeKit: { validatePluginDescriptor(value: unknown): unknown }, input: T): Readonly<T>;
