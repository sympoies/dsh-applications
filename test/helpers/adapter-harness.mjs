// Shared DSH rc2 adapter harness: a faithful in-memory stand-in for the DSH
// agent/session/tool surface and the host sandbox, extracted from the manager
// contract suite so profile-behavior suites can drive the same seams.
import { createDshRc2Adapter, REQUIRED_AMBIENT_DENIALS } from "../../packages/dsh-rc2-adapter/src/index.ts";

export function createAdapterHarness(options = {}) {
  const created = [];
  const resumed = [];
  const flushed = [];
  const configured = [];
  const restrictions = [];
  const guards = [];
  const hostExecutions = [];
  const releases = [];
  const inspectCalls = [];
  const disposeAttempts = [];
  const disposeCompletions = [];
  const releaseCompletions = [];
  const handles = new Map();
  const persisted = new Map();
  let failedCreates = options.failedCreates ?? 0;
  let failedRegistrations = options.failedRegistrations ?? 0;
  let failedDisposals = options.failedDisposals ?? 0;
  let failedReleases = options.failedReleases ?? 0;

  function makeHandle(sessionId, root) {
    const agent = {
      id: sessionId,
      session: { id: sessionId, header: { cwd: root } },
      status: "idle",
      cancelCalls: [],
      cancel(cause, cancelOptions) { this.cancelCalls.push({ cause, options: cancelOptions }); },
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

  async function setupAgent(sessionId, root, setup) {
    const handle = makeHandle(sessionId, root);
    let definition;
    let guard;
    const tools = {
      register(value) {
        if (failedRegistrations > 0) {
          failedRegistrations -= 1;
          throw new Error("injected scoped registration failure");
        }
        definition = value;
      },
      restrict(value) { restrictions.push(value); },
      guard(value) { guard = value; guards.push(value); },
      async execute(execution) {
        const denied = guard?.(execution);
        if (denied !== undefined) return { isError: true, error: { message: denied }, content: [] };
        if (definition?.name !== execution.name) return { isError: true, error: { message: "unknown tool" }, content: [] };
        try {
          const value = await definition.execute(execution.arguments, { ...execution, agent: execution.agent });
          return { isError: false, value: structuredClone(value), content: [] };
        } catch (error) {
          return { isError: true, error: { message: error.message }, content: [] };
        }
      },
    };
    await setup({ agent: handle.agent, tools });
    return handle;
  }

  const ctx = {
    agents: {
      async create(createOptions) {
        created.push(createOptions);
        const handle = await setupAgent(createOptions.sessionId, createOptions.meta.cwd, createOptions.setup);
        if (failedCreates > 0) { failedCreates -= 1; throw new Error("injected create failure"); }
        handles.set(createOptions.sessionId, handle);
        persisted.set(createOptions.sessionId, createOptions.meta.cwd);
        return handle;
      },
      async resume(resumeOptions) {
        resumed.push(resumeOptions);
        const root = persisted.get(resumeOptions.resumeSessionId);
        const handle = await setupAgent(resumeOptions.resumeSessionId, root, resumeOptions.setup);
        handles.set(resumeOptions.resumeSessionId, handle);
        return handle;
      },
      get(sessionId) { return handles.get(sessionId)?.agent; },
    },
    sessions: { async flush(session) { flushed.push(session.id); } },
    sessionPersistence: {
      async inspect(sessionId) {
        inspectCalls.push(sessionId);
        if (!persisted.has(sessionId)) throw new Error("not found");
        return { meta: { id: sessionId, cwd: persisted.get(sessionId) }, events: [] };
      },
    },
  };
  const runtimes = new Map();
  function defaultRuntime(instanceIdentity) {
    return {
      sessionId: `session-${instanceIdentity.instanceId}`,
      root: `/isolated/${instanceIdentity.instanceId}`,
      agentOptions: { provider: `provider-${instanceIdentity.instanceId}` },
      memory: { namespace: `memory-${instanceIdentity.instanceId}` },
      queue: { namespace: `queue-${instanceIdentity.instanceId}` },
      credentialHandles: { namespace: `credentials-${instanceIdentity.instanceId}` },
      budget: { namespace: `budget-${instanceIdentity.instanceId}` },
      concurrencyController: { namespace: `concurrency-${instanceIdentity.instanceId}` },
      async configureScope(agentCtx, runtime) { configured.push({ agentCtx, runtime }); },
    };
  }
  const hostSandbox = {
    async bind(facts) { return Object.freeze({ facts }); },
    async assertCurrent(binding, facts) {
      if (typeof options.assertCurrent === "function") await options.assertCurrent(binding, facts);
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
    async release(binding) {
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
    ctx,
    hostSandbox,
    resolveInstanceRuntime(instanceIdentity) {
      const runtime = options.runtimeFactory?.(instanceIdentity, runtimes) ?? defaultRuntime(instanceIdentity);
      runtimes.set(instanceIdentity.namespace, runtime);
      return runtime;
    },
  });
  return {
    adapter, ctx, created, resumed, flushed, configured, restrictions, guards,
    hostExecutions, releases, releaseCompletions, handles, persisted, runtimes,
    defaultRuntime, inspectCalls, disposeAttempts, disposeCompletions,
  };
}

export function invocation(instanceIdentity, input = { value: "ok" }) {
  return {
    identity: instanceIdentity,
    descriptor: { metadata: { id: "review" } },
    actionId: "review.pull-request",
    input,
    async hostAction(request) { return request; },
  };
}
