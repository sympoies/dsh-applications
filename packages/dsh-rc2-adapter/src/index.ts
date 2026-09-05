import { isAbsolute } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type {} from "@deepseek-ai/dsh-tools";

import type { JsonValue, PluginDescriptor } from "@sympoies/dsh-plugin-sdk";

export const REQUIRED_AMBIENT_DENIALS = Object.freeze([
  "env", "host-socket", "filesystem", "network", "subprocess",
  "credential", "secret", "provider", "clock", "random", "cross-instance",
] as const);

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

/** Untyped caller input after the object-shape check; every field is still validated. */
type Fields = Record<string, unknown>;

// The internal view of the DSH rc2 services and agent scope this adapter drives.
// `assertOwnerServices` and `assertAgentTools` establish only that the named
// service and tool methods exist and that the agent is an object. The member
// shapes below (`LiveAgent`, `AgentHandle`, `ToolExecution`, `ToolResult`) are
// the DSH rc2 contract this adapter relies on, not runtime-verified facts; the
// exact pinned DSH declarations check them in `npm run test:exact-dsh`.

interface LiveAgent {
  readonly id: string;
  readonly session: unknown;
  cancel(cause: unknown, options?: unknown): unknown;
  whenIdle(): Promise<unknown>;
}

interface AgentHandle {
  readonly agent: LiveAgent;
  dispose(): Promise<unknown>;
}

interface ToolExecution {
  readonly name?: string;
  readonly agent: unknown;
  readonly signal: AbortSignal;
}

interface ToolResult {
  readonly isError?: boolean;
  readonly value?: unknown;
  readonly error?: { readonly message?: string };
}

interface AgentTools {
  register(tool: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
    readonly output: unknown;
    execute(args: Fields | undefined, execution: ToolExecution): Promise<unknown>;
  }): unknown;
  restrict(policy: { readonly allow: readonly string[] }): unknown;
  guard(guard: (execution: ToolExecution | undefined) => string | undefined): unknown;
  execute(request: {
    readonly callId: string;
    readonly name: string;
    readonly arguments: Fields;
    readonly agent: LiveAgent;
    readonly signal: AbortSignal;
  }): Promise<ToolResult | undefined>;
}

interface AgentContext {
  readonly agent: LiveAgent;
  readonly tools: AgentTools;
}

interface OwnerServices {
  readonly agents: {
    create(options: unknown): Promise<AgentHandle>;
    resume(options: unknown): Promise<AgentHandle>;
    get(sessionId: string): LiveAgent | undefined;
  };
  readonly sessions: { flush(session: unknown): Promise<unknown> };
  readonly sessionPersistence: {
    inspect(sessionId: string): Promise<{ readonly meta?: { readonly id?: unknown; readonly cwd?: unknown } } | undefined>;
  };
}

type ResolveInstanceRuntime = (identity: DshRc2Identity) => unknown;

interface IdentityRequest {
  readonly identity: DshRc2Identity;
}

type OwnerToken = Readonly<{ owner: string }>;

interface OwnerMap {
  get(key: unknown): OwnerToken | undefined;
  set(key: unknown, token: OwnerToken): unknown;
  delete(key: unknown): boolean;
}

interface ReservationCandidate {
  readonly map: OwnerMap;
  readonly value: unknown;
  readonly label: string;
}

interface Reservation {
  readonly token: OwnerToken;
  readonly candidates: readonly ReservationCandidate[];
}

interface PendingInvocation {
  readonly invocation: DshPluginInvocation;
  readonly confinement: DshRc2Confinement;
}

interface ScopedAgent {
  readonly agent: LiveAgent;
  readonly binding: object;
  readonly pending: Map<string, PendingInvocation>;
  readonly executeTool: AgentTools["execute"];
}

interface InstanceEntry {
  readonly identity: DshRc2Identity;
  readonly runtime: DshRc2InstanceRuntime;
  readonly handle: AgentHandle;
  readonly scoped: ScopedAgent;
  readonly reservation: Reservation;
  accepting: boolean;
  retiring: boolean;
  retirementMode: "stale" | "stop" | undefined;
  cleanupPromise: Promise<void> | undefined;
  bindingReleased: boolean;
  handleDisposed: boolean;
  reservationReleased: boolean;
  inFlight: number;
  inFlightDrain: PromiseWithResolvers<void> | undefined;
  readonly controllers: Set<AbortController>;
}

interface LifecycleResult {
  readonly status: "succeeded" | "failed";
  readonly code?: "runtime-unavailable";
  readonly sessionIdentity?: string;
  readonly retainedStateDisposition?: "retained";
}

const IDENTITY_FIELDS = Object.freeze([
  "deploymentId", "profileId", "generationId", "instanceId", "namespace",
]);
const PLUGIN_TOOL = "sympoies_plugin_action";

function fail(message: string): never {
  throw new TypeError(message);
}

function canonicalIdentity(value: unknown, label = "instance identity"): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} is required`);
  const identity = value as Fields;
  if (Object.keys(identity).sort().join("\0") !== [...IDENTITY_FIELDS].sort().join("\0")) {
    fail(`${label} fields are invalid`);
  }
  for (const field of IDENTITY_FIELDS.slice(0, 4)) {
    if (typeof identity[field] !== "string" || identity[field].length === 0) fail(`${label}.${field} is required`);
  }
  const expected = `${identity.deploymentId}/${identity.profileId}/${identity.generationId}/${identity.instanceId}`;
  if (identity.namespace !== expected) fail(`${label}.namespace is not canonical`);
  return IDENTITY_FIELDS.map(field => identity[field]).join("\0");
}

function namespaceOf(value: unknown): string {
  const request = value as Partial<IdentityRequest> | null | undefined;
  canonicalIdentity(request?.identity);
  return (value as IdentityRequest).identity.namespace;
}

function assertRuntime(runtime: unknown): DshRc2InstanceRuntime {
  if (runtime === null || typeof runtime !== "object") fail("instance runtime is required");
  const candidate = runtime as Fields;
  if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) fail("instance sessionId is required");
  if (typeof candidate.root !== "string" || !isAbsolute(candidate.root)) fail("instance root must be absolute");
  for (const key of ["memory", "queue", "credentialHandles", "budget", "concurrencyController"]) {
    if (candidate[key] === null || typeof candidate[key] !== "object") fail(`instance ${key} controller is required`);
  }
  if (typeof candidate.configureScope !== "function") fail("instance configureScope is required");
  return runtime as DshRc2InstanceRuntime;
}

function assertOwnerServices(ctx: unknown, hostSandbox: unknown): void {
  const services = ctx as Partial<Record<keyof OwnerServices, Fields>> | null | undefined;
  for (const [owner, method] of [
    [services?.agents, "create"], [services?.agents, "resume"], [services?.agents, "get"],
    [services?.sessions, "flush"], [services?.sessionPersistence, "inspect"],
  ] as const) if (typeof owner?.[method] !== "function") fail(`DSH rc2 service ${method} is required`);
  const sandbox = hostSandbox as Fields | null | undefined;
  for (const method of ["bind", "assertCurrent", "execute"]) {
    if (typeof sandbox?.[method] !== "function") fail(`DSH/host sandbox owner ${method} is required`);
  }
}

function assertAgentTools(agentCtx: unknown): asserts agentCtx is AgentContext {
  const candidate = agentCtx as { readonly tools?: Fields; readonly agent?: unknown } | null | undefined;
  for (const method of ["register", "restrict", "guard", "execute"]) {
    if (typeof candidate?.tools?.[method] !== "function") fail(`DSH agent-scoped tools.${method} is required`);
  }
  if (candidate?.agent === null || typeof candidate?.agent !== "object") fail("DSH agent-scoped identity is required");
}

function assertConfinementEvidence(evidence: unknown, entry: InstanceEntry, identity: DshRc2Identity): DshRc2Confinement {
  const candidate = evidence as Partial<DshRc2Confinement> | null | undefined;
  if (candidate?.owner !== "DSH/host" || candidate.enforced !== true
    || !sameIdentity(candidate.identity, identity)
    || candidate.sessionId !== entry.runtime.sessionId
    || candidate.root !== entry.runtime.root
    || candidate.agentId !== entry.handle.agent.id
    || typeof candidate.scopeRevision !== "string" || candidate.scopeRevision.length === 0
    || !Array.isArray(candidate.deniedAmbient)
    || REQUIRED_AMBIENT_DENIALS.some(value => !candidate.deniedAmbient?.includes(value))) {
    fail("DSH/host confinement evidence is missing, stale, or cross-instance");
  }
  return candidate as DshRc2Confinement;
}

function sameIdentity(left: unknown, right: unknown): boolean {
  try {
    return canonicalIdentity(left) === canonicalIdentity(right);
  } catch {
    return false;
  }
}

export function createDshRc2Adapter<Binding extends object>(options: {
  ctx: DshRc2Context;
  resolveInstanceRuntime(identity: DshRc2Identity): DshRc2InstanceRuntime | Promise<DshRc2InstanceRuntime>;
  hostSandbox: DshHostSandboxOwner<Binding>;
}): DshRc2Adapter;
export function createDshRc2Adapter({ ctx: ownerServices, resolveInstanceRuntime: runtimeResolver, hostSandbox: sandboxOwner }: {
  ctx: unknown;
  resolveInstanceRuntime: unknown;
  hostSandbox: unknown;
}): DshRc2Adapter {
  assertOwnerServices(ownerServices, sandboxOwner);
  if (typeof runtimeResolver !== "function") fail("resolveInstanceRuntime is required");
  const ctx = ownerServices as OwnerServices;
  const resolveInstanceRuntime = runtimeResolver as ResolveInstanceRuntime;
  const hostSandbox = sandboxOwner as DshHostSandboxOwner<object>;
  const instances = new Map<string, InstanceEntry>();
  const resourceOwners = new WeakMap<object, OwnerToken>();
  const sessionOwners = new Map<string, OwnerToken>();
  const rootOwners = new Map<string, OwnerToken>();
  const preparing = new Set<string>();
  let invocationSequence = 0;

  function reserveUnique(identity: DshRc2Identity, runtime: DshRc2InstanceRuntime): Reservation {
    const owner = canonicalIdentity(identity);
    const token = Object.freeze({ owner });
    const candidates: ReservationCandidate[] = [
      ...(["memory", "queue", "credentialHandles", "budget", "concurrencyController"] as const)
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

  function rollbackReservation(reservation: Reservation): void {
    for (const { map, value } of reservation.candidates) {
      if (map.get(value) === reservation.token) map.delete(value);
    }
  }

  async function prepare(request: unknown, resume: boolean): Promise<LifecycleResult> {
    const namespace = namespaceOf(request);
    if (instances.has(namespace) || preparing.has(namespace)) {
      return { status: "failed", code: "runtime-unavailable" };
    }
    preparing.add(namespace);
    let reservation: Reservation | undefined;
    let scoped: ScopedAgent | undefined;
    let boundBinding: object | undefined;
    try {
      const identity = structuredClone((request as IdentityRequest).identity);
      const runtime = assertRuntime(await resolveInstanceRuntime(structuredClone(identity)));
      reservation = reserveUnique(identity, runtime);
      if (resume) {
        const inspection = await ctx.sessionPersistence.inspect(runtime.sessionId);
        if (inspection?.meta?.id !== runtime.sessionId || inspection.meta.cwd !== runtime.root) {
          fail("persisted DSH session is not bound to the instance root");
        }
      }
      const setup = async (agentCtx: unknown): Promise<void> => {
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
        const pending = new Map<string, PendingInvocation>();
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
            const row = pending.get(args?.invocationId as string);
            if (row === undefined) fail("plugin tool invocation is missing or already consumed");
            pending.delete(args?.invocationId as string);
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
      const entry: InstanceEntry = {
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

  function row(request: unknown): InstanceEntry | undefined {
    const namespace = namespaceOf(request);
    const entry = instances.get(namespace);
    if (entry !== undefined && !sameIdentity(entry.identity, (request as IdentityRequest).identity)) {
      fail("instance identity does not match the captured DSH entry");
    }
    return entry;
  }

  function beginDrain(entry: InstanceEntry): Promise<void> {
    if (entry.inFlight === 0) return Promise.resolve();
    if (entry.inFlightDrain === undefined) entry.inFlightDrain = Promise.withResolvers<void>();
    return entry.inFlightDrain.promise;
  }

  function finishInvocation(entry: InstanceEntry): void {
    entry.inFlight -= 1;
    if (entry.inFlight === 0 && entry.inFlightDrain !== undefined) {
      entry.inFlightDrain.resolve();
      entry.inFlightDrain = undefined;
    }
  }

  function fence(entry: InstanceEntry | undefined, reason: Error): void {
    if (entry === undefined) return;
    entry.accepting = false;
    for (const controller of entry.controllers) controller.abort(reason);
  }

  async function quiesce(
    entry: InstanceEntry | undefined,
    cause: { readonly kind: "user" | "parent" },
    options?: { readonly keepInbox: boolean },
  ): Promise<LifecycleResult> {
    if (entry === undefined) return { status: "failed", code: "runtime-unavailable" };
    entry.handle.agent.cancel(cause, options);
    await Promise.all([entry.handle.agent.whenIdle(), beginDrain(entry)]);
    await ctx.sessions.flush(entry.handle.agent.session);
    return { status: "succeeded" };
  }

  async function cleanupEntry(namespace: string, entry: InstanceEntry, mode: "stale" | "stop", reason: Error): Promise<void> {
    if (entry.retiring !== true) {
      entry.retiring = true;
      entry.retirementMode = mode;
      fence(entry, reason);
    }
    if (entry.cleanupPromise !== undefined) return entry.cleanupPromise;
    const cleanup = (async () => {
      await beginDrain(entry);
      const failures: unknown[] = [];
      if (!entry.bindingReleased) {
        try {
          await hostSandbox.release?.(entry.scoped.binding);
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

  const lifecycleEffects: DshRc2Adapter["lifecycleEffects"] = Object.freeze({
    start: (request: unknown) => prepare(request, false),
    async resume(request: unknown) {
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
        let live: LiveAgent | undefined;
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
    interrupt(request: unknown) {
      const entry = row(request);
      fence(entry, new Error("plugin instance interrupted"));
      return quiesce(entry, { kind: "user" });
    },
    drain(request: unknown) {
      const entry = row(request);
      fence(entry, new Error("plugin instance draining"));
      return quiesce(entry, { kind: "parent" }, { keepInbox: true });
    },
    stop(request: unknown) {
      const entry = row(request);
      if (entry === undefined) {
        return Promise.resolve({ status: "failed", code: "runtime-unavailable" });
      }
      return (async () => {
        await cleanupEntry(
          (request as IdentityRequest).identity.namespace,
          entry,
          "stop",
          new Error("plugin instance stopping"),
        );
        return { status: "succeeded", retainedStateDisposition: "retained" };
      })();
    },
  });

  async function executePlugin(invocation: DshPluginInvocation): Promise<JsonValue> {
    const entry = row(invocation);
    if (entry === undefined || entry.accepting !== true) fail("plugin instance is not accepting work");
    const captured = entry;
    captured.inFlight += 1;
    const controller = new AbortController();
    captured.controllers.add(controller);
    let invocationId: string | undefined;
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
      const scopedInvocation: DshPluginInvocation = Object.freeze({
        ...invocation,
        async hostAction(request: unknown) {
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
      return result.value as JsonValue;
    } finally {
      capabilityActive = false;
      if (invocationId !== undefined) captured.scoped.pending.delete(invocationId);
      captured.controllers.delete(controller);
      finishInvocation(captured);
    }
  }

  return Object.freeze({ lifecycleEffects, executePlugin });
}
