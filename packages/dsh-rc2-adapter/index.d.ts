export const REQUIRED_AMBIENT_DENIALS: readonly ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"];

export interface DshRc2Confinement {
  readonly owner: "DSH";
  readonly enforced: true;
  readonly namespace: string;
  readonly generationId: string;
  readonly scopeRevision: string;
  readonly deniedAmbient: readonly string[];
}

export interface DshRc2Adapter {
  readonly lifecycleEffects: Readonly<Record<"start" | "resume" | "interrupt" | "drain" | "stop", (request: unknown) => Promise<unknown>>>;
  executePlugin(invocation: unknown): Promise<unknown>;
  assertPluginConfinement(identity: unknown): Promise<DshRc2Confinement>;
}

export function createDshRc2Adapter(options: {
  ctx: unknown;
  resolveInstanceRuntime(identity: unknown): unknown | Promise<unknown>;
}): DshRc2Adapter;
