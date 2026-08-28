import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type {} from "@deepseek-ai/dsh-tools";

import type { JsonValue, PluginDescriptor } from "@sympoies/dsh-plugin-sdk";

export const REQUIRED_AMBIENT_DENIALS: readonly ["env", "host-socket", "filesystem", "network", "subprocess", "credential", "secret", "provider", "clock", "random", "cross-instance"];

export interface DshRc2Identity {
  readonly deploymentId: string;
  readonly profileId: string;
  readonly generationId: string;
  readonly instanceId: string;
  readonly namespace: string;
}

export interface DshRc2InstanceRuntime {
  readonly sessionId: string;
  readonly root: string;
  readonly agentOptions?: object;
  readonly memory: object;
  readonly queue: object;
  readonly credentialHandles: object;
  readonly budget: object;
  readonly concurrencyController: object;
  configureScope(agentContext: unknown, runtime: DshRc2InstanceRuntime): void | Promise<void>;
}

export interface DshRc2Confinement {
  readonly owner: "DSH/host";
  readonly enforced: true;
  readonly identity: DshRc2Identity;
  readonly sessionId: string;
  readonly root: string;
  readonly agentId: string;
  readonly scopeRevision: string;
  readonly deniedAmbient: readonly string[];
}

export interface DshHostSandboxOwner<Binding extends object = object> {
  bind(request: {
    readonly agentCtx: unknown;
    readonly agent: object;
    readonly identity: DshRc2Identity;
    readonly sessionId: string;
    readonly root: string;
  }): Binding | Promise<Binding>;
  assertCurrent(binding: Binding, request: {
    readonly agent: object;
    readonly identity: DshRc2Identity;
    readonly sessionId: string;
    readonly root: string;
  }): DshRc2Confinement | Promise<DshRc2Confinement>;
  execute(binding: Binding, invocation: DshPluginInvocation, context: {
    readonly agent: object;
    readonly signal: AbortSignal;
    readonly confinement: DshRc2Confinement;
  }): JsonValue | Promise<JsonValue>;
  release?(binding: Binding): void | Promise<void>;
}

export interface DshPluginInvocation {
  readonly descriptor: PluginDescriptor;
  readonly actionId: string;
  readonly identity: DshRc2Identity;
  readonly input: JsonValue;
  readonly hostAction: (request: unknown) => Promise<unknown>;
}

export interface DshRc2Adapter {
  readonly lifecycleEffects: Readonly<{
    start(request: unknown): Promise<unknown>;
    resume(request: unknown): Promise<unknown>;
    interrupt(request: unknown): Promise<unknown>;
    drain(request: unknown): Promise<unknown>;
    stop(request: unknown): Promise<unknown>;
  }>;
  executePlugin(invocation: DshPluginInvocation): Promise<JsonValue>;
}

export type DshRc2Context = Pick<Context, "agents" | "sessions" | "sessionPersistence">;

export function createDshRc2Adapter<Binding extends object>(options: {
  ctx: DshRc2Context;
  resolveInstanceRuntime(identity: DshRc2Identity): DshRc2InstanceRuntime | Promise<DshRc2InstanceRuntime>;
  hostSandbox: DshHostSandboxOwner<Binding>;
}): DshRc2Adapter;
