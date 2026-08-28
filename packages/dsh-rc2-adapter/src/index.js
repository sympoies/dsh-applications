const REQUIRED_AMBIENT_DENIALS = Object.freeze([
  "env", "host-socket", "filesystem", "network", "subprocess",
  "credential", "secret", "provider", "clock", "random", "cross-instance",
]);

function fail(message) {
  throw new TypeError(message);
}

function namespaceOf(value) {
  const namespace = value?.identity?.namespace;
  if (typeof namespace !== "string" || namespace.length === 0) fail("instance identity namespace is required");
  return namespace;
}

function assertRuntime(runtime) {
  if (runtime === null || typeof runtime !== "object") fail("instance runtime is required");
  if (typeof runtime.sessionId !== "string" || runtime.sessionId.length === 0) fail("instance sessionId is required");
  if (typeof runtime.root !== "string" || runtime.root.length === 0) fail("instance root is required");
  for (const key of ["memory", "queue", "credentialHandles", "budget", "concurrencyController"]) {
    if (runtime[key] === null || typeof runtime[key] !== "object") fail(`instance ${key} controller is required`);
  }
  const sandbox = runtime.sandbox;
  if (sandbox?.kind !== "dsh-rc2-enforced" || typeof sandbox.execute !== "function"
    || typeof sandbox.assertCurrentConfinement !== "function") fail("DSH rc2 enforced sandbox is required");
  if (!Array.isArray(sandbox.deniedAmbient) || REQUIRED_AMBIENT_DENIALS.some(value => !sandbox.deniedAmbient.includes(value))) {
    fail("DSH sandbox ambient-denial contract is incomplete");
  }
  if (typeof runtime.configureScope !== "function") fail("instance configureScope is required");
  return runtime;
}

function assertOwnerServices(ctx) {
  for (const [owner, method] of [
    [ctx?.agents, "create"], [ctx?.agents, "resume"], [ctx?.agents, "get"],
    [ctx?.sessions, "flush"], [ctx?.sessionPersistence, "inspect"],
    [ctx?.sessionPersistence, "list"], [ctx?.tools, "register"],
    [ctx?.tools, "guard"], [ctx?.tools, "restrict"], [ctx?.tools, "execute"],
  ]) if (typeof owner?.[method] !== "function") fail(`DSH rc2 service ${method} is required`);
}

export function createDshRc2Adapter({ ctx, resolveInstanceRuntime }) {
  assertOwnerServices(ctx);
  if (typeof resolveInstanceRuntime !== "function") fail("resolveInstanceRuntime is required");
  const instances = new Map();
  const resourceOwners = new WeakMap();
  const sessionOwners = new Map();
  const rootOwners = new Map();

  function bindUnique(namespace, runtime) {
    for (const key of ["memory", "queue", "credentialHandles", "budget", "concurrencyController"]) {
      const previous = resourceOwners.get(runtime[key]);
      if (previous !== undefined && previous !== namespace) fail(`${key} is shared across instances`);
      resourceOwners.set(runtime[key], namespace);
    }
    for (const [map, value, label] of [[sessionOwners, runtime.sessionId, "session"], [rootOwners, runtime.root, "root"]]) {
      const previous = map.get(value);
      if (previous !== undefined && previous !== namespace) fail(`${label} is shared across instances`);
      map.set(value, namespace);
    }
  }

  async function prepare(request, resume) {
    const namespace = namespaceOf(request);
    const runtime = assertRuntime(await resolveInstanceRuntime(structuredClone(request.identity)));
    bindUnique(namespace, runtime);
    const setup = async agentCtx => {
      if (typeof agentCtx?.tools?.register !== "function" || typeof agentCtx?.tools?.restrict !== "function"
        || typeof agentCtx?.tools?.guard !== "function" || typeof agentCtx?.tools?.execute !== "function") {
        fail("DSH agent-scoped tool services are required");
      }
      agentCtx.tools.restrict({ allow: [] });
      agentCtx.tools.guard(execution => execution?.name === "sympoies_host_action"
        ? undefined : "plugin ambient tool denied");
      await runtime.configureScope(agentCtx, runtime);
    };
    if (resume) {
      try {
        const headers = await ctx.sessionPersistence.list();
        if (!Array.isArray(headers) || !headers.some(header => header?.id === runtime.sessionId)) {
          return { status: "failed", code: "runtime-unavailable" };
        }
        const inspection = await ctx.sessionPersistence.inspect(runtime.sessionId);
        if (inspection?.meta?.id !== runtime.sessionId) return { status: "failed", code: "runtime-unavailable" };
      } catch {
        return { status: "failed", code: "runtime-unavailable" };
      }
    }
    const handle = resume
      ? await ctx.agents.resume({ resumeSessionId: runtime.sessionId, agentOptions: runtime.agentOptions, setup })
      : await ctx.agents.create({ sessionId: runtime.sessionId, meta: { cwd: runtime.root }, agentOptions: runtime.agentOptions, setup });
    instances.set(namespace, { runtime, handle, accepting: true });
    return { status: "succeeded", sessionIdentity: runtime.sessionId };
  }

  function row(request) {
    return instances.get(namespaceOf(request));
  }

  async function quiesce(entry, cause, options) {
    if (entry === undefined) return { status: "failed", code: "runtime-unavailable" };
    entry.handle.agent.cancel(cause, options);
    await entry.handle.agent.whenIdle();
    await ctx.sessions.flush(entry.handle.agent.session);
    return { status: "succeeded" };
  }

  const lifecycleEffects = Object.freeze({
    start: request => prepare(request, false),
    resume(request) {
      const namespace = namespaceOf(request);
      const entry = row(request);
      if (entry !== undefined) {
        let live;
        try {
          live = ctx.agents.get(entry.runtime.sessionId);
        } catch {
          return Promise.resolve({ status: "failed", code: "runtime-unavailable" });
        }
        if (live !== entry.handle.agent) {
          entry.accepting = false;
          if (live !== undefined) return Promise.resolve({ status: "failed", code: "runtime-unavailable" });
          instances.delete(namespace);
          return prepare(request, true);
        }
        entry.accepting = true;
        return Promise.resolve({ status: "succeeded", sessionIdentity: entry.runtime.sessionId });
      }
      return prepare(request, true);
    },
    interrupt(request) {
      const entry = row(request);
      if (entry !== undefined) entry.accepting = false;
      return quiesce(entry, { kind: "user" });
    },
    async drain(request) {
      const entry = row(request);
      if (entry !== undefined) entry.accepting = false;
      return quiesce(entry, { kind: "parent" }, { keepInbox: true });
    },
    async stop(request) {
      const namespace = namespaceOf(request);
      const entry = instances.get(namespace);
      if (entry === undefined) return { status: "failed", code: "runtime-unavailable" };
      await entry.handle.dispose();
      instances.delete(namespace);
      return { status: "succeeded", retainedStateDisposition: "retained" };
    },
  });

  async function executePlugin(invocation) {
    const namespace = namespaceOf(invocation);
    const entry = instances.get(namespace);
    if (entry === undefined || entry.accepting !== true) fail("plugin instance is not accepting work");
    return entry.runtime.sandbox.execute(Object.freeze({
      descriptor: invocation.descriptor,
      actionId: invocation.actionId,
      identity: invocation.identity,
      input: invocation.input,
      hostAction: invocation.hostAction,
    }));
  }

  async function assertPluginConfinement(identity) {
    const namespace = identity?.namespace;
    const entry = typeof namespace === "string" ? instances.get(namespace) : undefined;
    if (entry === undefined || entry.accepting !== true) fail("plugin instance has no current DSH confinement");
    const evidence = await entry.runtime.sandbox.assertCurrentConfinement(structuredClone(identity));
    if (evidence?.owner !== "DSH" || evidence.enforced !== true
      || evidence.namespace !== namespace || evidence.generationId !== identity.generationId
      || typeof evidence.scopeRevision !== "string" || evidence.scopeRevision.length === 0
      || !Array.isArray(evidence.deniedAmbient)
      || REQUIRED_AMBIENT_DENIALS.some(value => !evidence.deniedAmbient.includes(value))) {
      fail("DSH confinement evidence is missing, stale, or cross-instance");
    }
    return Object.freeze(structuredClone(evidence));
  }

  return Object.freeze({ lifecycleEffects, executePlugin, assertPluginConfinement });
}

export { REQUIRED_AMBIENT_DENIALS };
