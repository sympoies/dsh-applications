export const PUBLIC_MANAGER_OPERATIONS: readonly ["validate", "resolve", "lock", "start", "resume", "status", "interrupt", "drain", "stop", "doctor"];

export type PublicManagerOperation = typeof PUBLIC_MANAGER_OPERATIONS[number];
export type PublicApplicationManager = Readonly<Record<PublicManagerOperation, (request: unknown) => Promise<unknown> | unknown>>;

export function createApplicationManager(options: {
  runtimeKit: Record<string, unknown>;
  dshAdapter: Record<string, unknown>;
  composition?: unknown;
  trustVerifier: object;
  health(probe: string, context: unknown): unknown | Promise<unknown>;
  host?: {
    authorize?: (request: unknown) => unknown | Promise<unknown>;
    effect?: (request: unknown, context: unknown) => unknown | Promise<unknown>;
    broker?: (request: unknown, context: unknown) => unknown | Promise<unknown>;
    journal?: Map<string, unknown>;
  };
}): PublicApplicationManager;

export function createApplicationControlService(options: {
  runtimeKit: Record<string, unknown>;
  manager: PublicApplicationManager;
  peers: Record<string, { operations: string[]; namespacePrefixes: string[] }>;
  nonceHighWater?: Map<string, string>;
  reconcileEvidence(request: unknown, context: unknown): unknown | Promise<unknown>;
}): { handle(frame: unknown, context: unknown): Promise<unknown> };

export function createPluginSandbox(options: {
  runtimeKit: Record<string, unknown>;
  manager: PublicApplicationManager;
  dshAdapter: Record<string, unknown>;
}): { invoke(request: unknown): Promise<unknown> };
