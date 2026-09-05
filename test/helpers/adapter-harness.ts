// Shared DSH rc2 adapter harness: a faithful in-memory stand-in for the DSH
// agent/session/tool surface and the host sandbox, extracted from the manager
// contract suite so profile-behavior suites can drive the same seams.
import assert from "node:assert/strict";
import {
  createDshRc2Adapter,
  REQUIRED_AMBIENT_DENIALS,
  type DshHostSandboxOwner,
  type DshPluginInvocation,
  type DshRc2Context,
  type DshRc2Identity,
  type DshRc2InstanceRuntime,
} from "../../packages/dsh-rc2-adapter/src/index.ts";
import type { JsonValue } from "../../packages/plugin-sdk/src/index.ts";
import { pluginDescriptor } from "./owner-fixtures.ts";

interface HarnessOptions {
  failedCreates?: number;
  failedRegistrations?: number;
  failedDisposals?: number;
  failedReleases?: number;
  omitRelease?: boolean;
  beforeDispose?(): void | Promise<void>;
  assertCurrent?(binding: Binding, facts: CurrentFacts): void | Promise<void>;
  execute?(invocation: DshPluginInvocation, context: unknown): JsonValue | Promise<JsonValue>;
  runtimeFactory?(identity: DshRc2Identity, runtimes: Map<string, TestRuntime>): TestRuntime | Promise<TestRuntime>;
}

type TestRuntime = DshRc2InstanceRuntime & Record<string, any>;
type TestAdapter = Omit<ReturnType<typeof createDshRc2Adapter>, "lifecycleEffects" | "executePlugin"> & {
  lifecycleEffects: Record<"start" | "resume" | "interrupt" | "drain" | "stop", (request: any) => Promise<any>>;
  executePlugin(invocation: DshPluginInvocation): Promise<any>;
};

type SandboxFacts = Parameters<DshHostSandboxOwner<object>["bind"]>[0];
type CurrentFacts = Parameters<DshHostSandboxOwner<object>["assertCurrent"]>[1];
interface Binding { readonly facts: SandboxFacts }
interface LiveAgent {
  id: string;
  session: { id: string; header: { cwd: string } };
  status: string;
  cancelCalls: Array<{ cause: unknown; options: unknown }>;
  cancel(cause: unknown, options?: unknown): void;
  whenIdle(): Promise<void>;
}
interface Handle { agent: LiveAgent; dispose(): Promise<void> }
interface ToolExecution {
  name: string;
  arguments: unknown;
  agent: LiveAgent;
  signal: AbortSignal;
}
interface ToolDefinition { name: string; execute(arguments_: unknown, context: ToolExecution): unknown | Promise<unknown> }
type ToolGuard = (execution: ToolExecution) => string | undefined;

export function createAdapterHarness(options: HarnessOptions = {}) {
  const created: any[] = [];
  const resumed: any[] = [];
  const flushed: string[] = [];
  const configured: Array<{ agentCtx: unknown; runtime: DshRc2InstanceRuntime }> = [];
  const restrictions: any[] = [];
  const guards: ToolGuard[] = [];
  const hostExecutions: Array<{ invocation: DshPluginInvocation; context: unknown }> = [];
  const releases: Binding[] = [];
  const inspectCalls: string[] = [];
  const disposeAttempts: string[] = [];
  const disposeCompletions: string[] = [];
  const releaseCompletions: Binding[] = [];
  const handles = new Map<string, Handle>();
  const persisted = new Map<string, string>();
  let failedCreates = options.failedCreates ?? 0;
  let failedRegistrations = options.failedRegistrations ?? 0;
  let failedDisposals = options.failedDisposals ?? 0;
  let failedReleases = options.failedReleases ?? 0;

  function makeHandle(sessionId: string, root: string): Handle {
    const agent: LiveAgent = {
      id: sessionId,
      session: { id: sessionId, header: { cwd: root } },
      status: "idle",
      cancelCalls: [],
      cancel(cause: unknown, cancelOptions?: unknown) { this.cancelCalls.push({ cause, options: cancelOptions }); },
      async whenIdle() {},
    };
    return {
      agent,
      async dispose() {
        disposeAttempts.push(sessionId);
        if (typeof options.beforeDispose === "function") await options.beforeDispose();
        if (failedDisposals > 0) {
          failedDisposals -= 1;
          throw new Error("injected dispose failure");
        }
        handles.delete(sessionId);
        disposeCompletions.push(sessionId);
      },
    };
  }

  async function setupAgent(sessionId: string, root: string, setup: (scope: unknown) => unknown | Promise<unknown>) {
    const handle = makeHandle(sessionId, root);
    let definition: ToolDefinition | undefined;
    let guard: ToolGuard | undefined;
    const tools = {
      register(value: ToolDefinition) {
        if (failedRegistrations > 0) {
          failedRegistrations -= 1;
          throw new Error("injected scoped registration failure");
        }
        definition = value;
      },
      restrict(value: unknown) { restrictions.push(value); },
      guard(value: ToolGuard) { guard = value; guards.push(value); },
      async execute(execution: ToolExecution) {
        const denied = guard?.(execution);
        if (denied !== undefined) return { isError: true, error: { message: denied }, content: [] };
        if (definition?.name !== execution.name) return { isError: true, error: { message: "unknown tool" }, content: [] };
        try {
          const value = await definition.execute(execution.arguments, { ...execution, agent: execution.agent });
          return { isError: false, value: structuredClone(value), content: [] };
        } catch (error) {
          return { isError: true, error: { message: error instanceof Error ? error.message : String(error) }, content: [] };
        }
      },
    };
    await setup({ agent: handle.agent, tools });
    return handle;
  }

  const ctx = {
    agents: {
      async create(createOptions: any) {
        created.push(createOptions);
        const handle = await setupAgent(createOptions.sessionId, createOptions.meta.cwd, createOptions.setup);
        if (failedCreates > 0) { failedCreates -= 1; throw new Error("injected create failure"); }
        handles.set(createOptions.sessionId, handle);
        persisted.set(createOptions.sessionId, createOptions.meta.cwd);
        return handle;
      },
      async resume(resumeOptions: any) {
        resumed.push(resumeOptions);
        const root = persisted.get(resumeOptions.resumeSessionId);
        assert.equal(typeof root, "string");
        const handle = await setupAgent(resumeOptions.resumeSessionId, root!, resumeOptions.setup);
        handles.set(resumeOptions.resumeSessionId, handle);
        return handle;
      },
      get(sessionId: string) { return handles.get(sessionId)?.agent; },
    },
    sessions: { async flush(session: { id: string }) { flushed.push(session.id); } },
    sessionPersistence: {
      async inspect(sessionId: string) {
        inspectCalls.push(sessionId);
        if (!persisted.has(sessionId)) throw new Error("not found");
        return { meta: { id: sessionId, cwd: persisted.get(sessionId) }, events: [] };
      },
    },
  };
  const runtimes = new Map<string, TestRuntime>();
  function defaultRuntime(instanceIdentity: DshRc2Identity): TestRuntime {
    return {
      sessionId: `session-${instanceIdentity.instanceId}`,
      root: `/isolated/${instanceIdentity.instanceId}`,
      agentOptions: { provider: `provider-${instanceIdentity.instanceId}` },
      memory: { namespace: `memory-${instanceIdentity.instanceId}` },
      queue: { namespace: `queue-${instanceIdentity.instanceId}` },
      credentialHandles: { namespace: `credentials-${instanceIdentity.instanceId}` },
      budget: { namespace: `budget-${instanceIdentity.instanceId}` },
      concurrencyController: { namespace: `concurrency-${instanceIdentity.instanceId}` },
      async configureScope(agentCtx: unknown, runtime: DshRc2InstanceRuntime) { configured.push({ agentCtx, runtime }); },
    };
  }
  const hostSandbox: DshHostSandboxOwner<Binding> = {
    async bind(facts) { return Object.freeze({ facts: facts as SandboxFacts }); },
    async assertCurrent(binding, facts) {
      if (typeof options.assertCurrent === "function") await options.assertCurrent(binding, facts);
      assert("id" in facts.agent && typeof facts.agent.id === "string");
      return {
        owner: "DSH/host",
        enforced: true,
        identity: structuredClone(facts.identity),
        sessionId: facts.sessionId,
        root: facts.root,
        agentId: facts.agent.id,
        scopeRevision: "1",
        deniedAmbient: [...REQUIRED_AMBIENT_DENIALS],
      };
    },
    async execute(_binding, invocation, context) {
      hostExecutions.push({ invocation, context });
      if (typeof options.execute === "function") return options.execute(invocation, context);
      return invocation.input;
    },
    async release(binding: Binding) {
      releases.push(binding);
      if (failedReleases > 0) {
        failedReleases -= 1;
        throw new Error("injected release failure");
      }
      releaseCompletions.push(binding);
    },
  };
  if (options.omitRelease === true) delete hostSandbox.release;
  const adapter = createDshRc2Adapter({
    ctx: ctx as unknown as DshRc2Context,
    hostSandbox,
    async resolveInstanceRuntime(instanceIdentity: DshRc2Identity) {
      const runtime = await (options.runtimeFactory?.(instanceIdentity, runtimes) ?? defaultRuntime(instanceIdentity));
      runtimes.set(instanceIdentity.namespace, runtime);
      return runtime;
    },
  }) as TestAdapter;
  return {
    adapter, ctx, created, resumed, flushed, configured, restrictions, guards,
    hostExecutions, releases, releaseCompletions, handles, persisted, runtimes,
    defaultRuntime, inspectCalls, disposeAttempts, disposeCompletions,
  };
}

export function invocation(instanceIdentity: DshRc2Identity, input: JsonValue = { value: "ok" }): DshPluginInvocation {
  return {
    identity: instanceIdentity,
    descriptor: pluginDescriptor(),
    actionId: "review.pull-request",
    input,
    async hostAction(request: unknown) { return request; },
  };
}
