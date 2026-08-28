import { isAbsolute } from "node:path";

export const REQUIRED_AMBIENT_DENIALS = Object.freeze([
  "env", "host-socket", "filesystem", "network", "subprocess",
  "credential", "secret", "provider", "clock", "random", "cross-instance",
]);

const IDENTITY_FIELDS = Object.freeze([
  "deploymentId", "profileId", "generationId", "instanceId", "namespace",
]);
const PLUGIN_TOOL = "sympoies_plugin_action";

function fail(message) {
  throw new TypeError(message);
}

function canonicalIdentity(value, label = "instance identity") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} is required`);
  if (Object.keys(value).sort().join("\0") !== [...IDENTITY_FIELDS].sort().join("\0")) {
    fail(`${label} fields are invalid`);
  }
  for (const field of IDENTITY_FIELDS.slice(0, 4)) {
    if (typeof value[field] !== "string" || value[field].length === 0) fail(`${label}.${field} is required`);
  }
  const expected = `${value.deploymentId}/${value.profileId}/${value.generationId}/${value.instanceId}`;
  if (value.namespace !== expected) fail(`${label}.namespace is not canonical`);
  return IDENTITY_FIELDS.map(field => value[field]).join("\0");
}

function namespaceOf(value) {
  canonicalIdentity(value?.identity);
  return value.identity.namespace;
}

function assertRuntime(runtime) {
  if (runtime === null || typeof runtime !== "object") fail("instance runtime is required");
  if (typeof runtime.sessionId !== "string" || runtime.sessionId.length === 0) fail("instance sessionId is required");
  if (typeof runtime.root !== "string" || !isAbsolute(runtime.root)) fail("instance root must be absolute");
  for (const key of ["memory", "queue", "credentialHandles", "budget", "concurrencyController"]) {
    if (runtime[key] === null || typeof runtime[key] !== "object") fail(`instance ${key} controller is required`);
  }
  if (typeof runtime.configureScope !== "function") fail("instance configureScope is required");
  return runtime;
}

function assertOwnerServices(ctx, hostSandbox) {
  for (const [owner, method] of [
    [ctx?.agents, "create"], [ctx?.agents, "resume"], [ctx?.agents, "get"],
    [ctx?.sessions, "flush"], [ctx?.sessionPersistence, "inspect"],
  ]) if (typeof owner?.[method] !== "function") fail(`DSH rc2 service ${method} is required`);
  for (const method of ["bind", "assertCurrent", "execute"]) {
    if (typeof hostSandbox?.[method] !== "function") fail(`DSH/host sandbox owner ${method} is required`);
  }
}

function assertAgentTools(agentCtx) {
  for (const method of ["register", "restrict", "guard", "execute"]) {
    if (typeof agentCtx?.tools?.[method] !== "function") fail(`DSH agent-scoped tools.${method} is required`);
  }
  if (agentCtx.agent === null || typeof agentCtx.agent !== "object") fail("DSH agent-scoped identity is required");
}

function assertConfinementEvidence(evidence, entry, identity) {
  if (evidence?.owner !== "DSH/host" || evidence.enforced !== true
    || !sameIdentity(evidence.identity, identity)
    || evidence.sessionId !== entry.runtime.sessionId
    || evidence.root !== entry.runtime.root
    || evidence.agentId !== entry.handle.agent.id
    || typeof evidence.scopeRevision !== "string" || evidence.scopeRevision.length === 0
    || !Array.isArray(evidence.deniedAmbient)
    || REQUIRED_AMBIENT_DENIALS.some(value => !evidence.deniedAmbient.includes(value))) {
    fail("DSH/host confinement evidence is missing, stale, or cross-instance");
  }
  return evidence;
}

function sameIdentity(left, right) {
  try {
    return canonicalIdentity(left) === canonicalIdentity(right);
  } catch {
    return false;
  }
}

export function createDshRc2Adapter({ ctx, resolveInstanceRuntime, hostSandbox }) {
  assertOwnerServices(ctx, hostSandbox);
  if (typeof resolveInstanceRuntime !== "function") fail("resolveInstanceRuntime is required");
  const instances = new Map();
  const resourceOwners = new WeakMap();
  const sessionOwners = new Map();
  const rootOwners = new Map();
  const preparing = new Set();
  let invocationSequence = 0;

  function reserveUnique(identity, runtime) {
    const owner = canonicalIdentity(identity);
    const token = Object.freeze({ owner });
    const candidates = [
      ...["memory", "queue", "credentialHandles", "budget", "concurrencyController"]
        .map(label => ({ map: resourceOwners, value: runtime[label], label })),
      { map: sessionOwners, value: runtime.sessionId, label: "session" },
      { map: rootOwners, value: runtime.root, label: "root" },
    ];
    for (const { map, value, label } of candidates) {
      const previous = map.get(value);
      if (previous !== undefined && previous.owner !== owner) fail(`${label} is shared across instances`);
    }
    for (const { map, value } of candidates) map.set(value, token);
    return Object.freeze({ token, candidates });
  }

  function rollbackReservation(reservation) {
    for (const { map, value } of reservation.candidates) {
      if (map.get(value) === reservation.token) map.delete(value);
    }
  }

  async function prepare(request, resume) {
    const namespace = namespaceOf(request);
    if (instances.has(namespace) || preparing.has(namespace)) {
      return { status: "failed", code: "runtime-unavailable" };
    }
    preparing.add(namespace);
    let reservation;
    let scoped;
    let boundBinding;
    try {
      const identity = structuredClone(request.identity);
      const runtime = assertRuntime(await resolveInstanceRuntime(structuredClone(identity)));
      reservation = reserveUnique(identity, runtime);
      if (resume) {
        const inspection = await ctx.sessionPersistence.inspect(runtime.sessionId);
        if (inspection?.meta?.id !== runtime.sessionId || inspection.meta.cwd !== runtime.root) {
          fail("persisted DSH session is not bound to the instance root");
        }
      }
      const setup = async agentCtx => {
        assertAgentTools(agentCtx);
        await runtime.configureScope(agentCtx, runtime);
        const binding = await hostSandbox.bind(Object.freeze({
          agentCtx,
          agent: agentCtx.agent,
          identity: structuredClone(identity),
          sessionId: runtime.sessionId,
          root: runtime.root,
        }));
        if (binding === null || typeof binding !== "object") {
          fail("DSH/host sandbox owner returned no scoped binding");
        }
        boundBinding = binding;
        const pending = new Map();
        agentCtx.tools.register({
          name: PLUGIN_TOOL,
          description: "Execute one admitted Sympoies plugin action in the bound host sandbox.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { invocationId: { type: "string" } },
            required: ["invocationId"],
          },
          output: { schema: {}, render: () => [] },
          async execute(args, execution) {
            if (execution.agent !== agentCtx.agent) fail("plugin tool caller is not the bound DSH agent");
            const row = pending.get(args?.invocationId);
            if (row === undefined) fail("plugin tool invocation is missing or already consumed");
            pending.delete(args.invocationId);
            return hostSandbox.execute(binding, row.invocation, Object.freeze({
              agent: agentCtx.agent,
              signal: execution.signal,
              confinement: row.confinement,
            }));
          },
        });
        // Visibility is useful for the agent surface but is not confinement evidence.
        agentCtx.tools.restrict({ allow: [] });
        agentCtx.tools.guard(execution => execution?.name === PLUGIN_TOOL
          ? undefined : "plugin ambient tool denied");
        scoped = Object.freeze({
          agent: agentCtx.agent,
          binding,
          pending,
          executeTool: agentCtx.tools.execute.bind(agentCtx.tools),
        });
      };
      const handle = resume
        ? await ctx.agents.resume({ resumeSessionId: runtime.sessionId, agentOptions: runtime.agentOptions, setup })
        : await ctx.agents.create({
          sessionId: runtime.sessionId,
          meta: { cwd: runtime.root },
          agentOptions: runtime.agentOptions,
          setup,
        });
      if (scoped === undefined || scoped.agent !== handle.agent) {
        await handle.dispose();
        fail("DSH setup did not bind the published live agent");
      }
      const entry = {
        identity,
        runtime,
        handle,
        scoped,
        reservation,
        accepting: true,
        retiring: false,
        retirementMode: undefined,
        cleanupPromise: undefined,
        bindingReleased: typeof hostSandbox.release !== "function",
        handleDisposed: false,
        reservationReleased: false,
        inFlight: 0,
        inFlightDrain: undefined,
        controllers: new Set(),
      };
      instances.set(namespace, entry);
      return { status: "succeeded", sessionIdentity: runtime.sessionId };
    } catch {
      if (reservation !== undefined) rollbackReservation(reservation);
      if (boundBinding !== undefined && typeof hostSandbox.release === "function") {
        try { await hostSandbox.release(boundBinding); } catch { /* preparation is already failed */ }
      }
      return { status: "failed", code: "runtime-unavailable" };
    } finally {
      preparing.delete(namespace);
    }
  }

  function row(request) {
    const namespace = namespaceOf(request);
    const entry = instances.get(namespace);
    if (entry !== undefined && !sameIdentity(entry.identity, request.identity)) {
      fail("instance identity does not match the captured DSH entry");
    }
    return entry;
  }

  function beginDrain(entry) {
    if (entry.inFlight === 0) return Promise.resolve();
    if (entry.inFlightDrain === undefined) entry.inFlightDrain = Promise.withResolvers();
    return entry.inFlightDrain.promise;
  }

  function finishInvocation(entry) {
    entry.inFlight -= 1;
    if (entry.inFlight === 0 && entry.inFlightDrain !== undefined) {
      entry.inFlightDrain.resolve();
      entry.inFlightDrain = undefined;
    }
  }

  function fence(entry, reason) {
    if (entry === undefined) return;
    entry.accepting = false;
    for (const controller of entry.controllers) controller.abort(reason);
  }

  async function quiesce(entry, cause, options) {
    if (entry === undefined) return { status: "failed", code: "runtime-unavailable" };
    entry.handle.agent.cancel(cause, options);
    await Promise.all([entry.handle.agent.whenIdle(), beginDrain(entry)]);
    await ctx.sessions.flush(entry.handle.agent.session);
    return { status: "succeeded" };
  }

  async function cleanupEntry(namespace, entry, mode, reason) {
    if (entry.retiring !== true) {
      entry.retiring = true;
      entry.retirementMode = mode;
      fence(entry, reason);
    }
    if (entry.cleanupPromise !== undefined) return entry.cleanupPromise;
    const cleanup = (async () => {
      await beginDrain(entry);
      const failures = [];
      if (!entry.bindingReleased) {
        try {
          await hostSandbox.release(entry.scoped.binding);
          entry.bindingReleased = true;
        } catch (error) {
          failures.push(error);
        }
      }
      if (!entry.handleDisposed) {
        try {
          await entry.handle.dispose();
          entry.handleDisposed = true;
        } catch (error) {
          failures.push(error);
        }
      }
      if (entry.bindingReleased && entry.handleDisposed) {
        if (!entry.reservationReleased) {
          rollbackReservation(entry.reservation);
          entry.reservationReleased = true;
        }
        if (instances.get(namespace) === entry) instances.delete(namespace);
      }
      if (failures.length > 0) throw new AggregateError(failures, "DSH plugin instance disposal failed");
    })();
    entry.cleanupPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (entry.cleanupPromise === cleanup) entry.cleanupPromise = undefined;
    }
  }

  const lifecycleEffects = Object.freeze({
    start: request => prepare(request, false),
    async resume(request) {
      const namespace = namespaceOf(request);
      const entry = row(request);
      if (entry !== undefined) {
        if (entry.retiring === true) {
          if (entry.retirementMode !== "stale") return { status: "failed", code: "runtime-unavailable" };
          try {
            await cleanupEntry(namespace, entry, "stale", new Error("DSH agent entry was replaced"));
          } catch {
            return { status: "failed", code: "runtime-unavailable" };
          }
          return prepare(request, true);
        }
        let live;
        try { live = ctx.agents.get(entry.runtime.sessionId); } catch {
          return { status: "failed", code: "runtime-unavailable" };
        }
        if (live === entry.handle.agent) {
          entry.accepting = true;
          return { status: "succeeded", sessionIdentity: entry.runtime.sessionId };
        }
        if (live !== undefined) {
          fence(entry, new Error("DSH session identity collision"));
          return { status: "failed", code: "runtime-unavailable" };
        }
        try {
          await cleanupEntry(namespace, entry, "stale", new Error("DSH agent entry was replaced"));
        } catch {
          return { status: "failed", code: "runtime-unavailable" };
        }
      }
      return prepare(request, true);
    },
    interrupt(request) {
      const entry = row(request);
      fence(entry, new Error("plugin instance interrupted"));
      return quiesce(entry, { kind: "user" });
    },
    drain(request) {
      const entry = row(request);
      fence(entry, new Error("plugin instance draining"));
      return quiesce(entry, { kind: "parent" }, { keepInbox: true });
    },
    stop(request) {
      const entry = row(request);
      if (entry === undefined) {
        return Promise.resolve({ status: "failed", code: "runtime-unavailable" });
      }
      return (async () => {
        await cleanupEntry(
          request.identity.namespace,
          entry,
          "stop",
          new Error("plugin instance stopping"),
        );
        return { status: "succeeded", retainedStateDisposition: "retained" };
      })();
    },
  });

  async function executePlugin(invocation) {
    const entry = row(invocation);
    if (entry === undefined || entry.accepting !== true) fail("plugin instance is not accepting work");
    const captured = entry;
    captured.inFlight += 1;
    const controller = new AbortController();
    captured.controllers.add(controller);
    let invocationId;
    let capabilityActive = true;
    try {
      const confinement = assertConfinementEvidence(await hostSandbox.assertCurrent(
        captured.scoped.binding,
        Object.freeze({
          agent: captured.handle.agent,
          identity: structuredClone(invocation.identity),
          sessionId: captured.runtime.sessionId,
          root: captured.runtime.root,
        }),
      ), captured, invocation.identity);
      if (instances.get(invocation.identity.namespace) !== captured || captured.accepting !== true) {
        fail("plugin instance changed while confinement was being established");
      }
      invocationSequence += 1;
      invocationId = `${captured.runtime.sessionId}:${invocationSequence}`;
      const scopedInvocation = Object.freeze({
        ...invocation,
        async hostAction(request) {
          if (!capabilityActive || controller.signal.aborted) {
            fail("plugin host capability is no longer active");
          }
          return invocation.hostAction(request);
        },
      });
      captured.scoped.pending.set(invocationId, Object.freeze({ invocation: scopedInvocation, confinement }));
      const result = await captured.scoped.executeTool({
        callId: `sympoies-plugin-${invocationSequence}`,
        name: PLUGIN_TOOL,
        arguments: { invocationId },
        agent: captured.handle.agent,
        signal: controller.signal,
      });
      if (result?.isError !== false) fail(`DSH plugin tool failed: ${result?.error?.message ?? "unknown failure"}`);
      return result.value;
    } finally {
      capabilityActive = false;
      if (invocationId !== undefined) captured.scoped.pending.delete(invocationId);
      captured.controllers.delete(controller);
      finishInvocation(captured);
    }
  }

  return Object.freeze({ lifecycleEffects, executePlugin });
}
