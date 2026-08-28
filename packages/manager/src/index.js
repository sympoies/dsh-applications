import { definePlugin } from "@sympoies/dsh-plugin-sdk";

export const PUBLIC_MANAGER_OPERATIONS = Object.freeze([
  "validate", "resolve", "lock", "start", "resume", "status",
  "interrupt", "drain", "stop", "doctor",
]);

const REQUIRED_RUNTIME_KIT = Object.freeze([
  "createMemoryRuntimeStore", "createCompositionService", "createWorkloadManager",
  "createMediatedHostService", "createManagerControlService",
  "validateMediatedHostActionRequest", "validatePluginDescriptor",
]);
const REQUIRED_AMBIENT_DENIALS = Object.freeze([
  "env", "host-socket", "filesystem", "network", "subprocess",
  "credential", "secret", "provider", "clock", "random", "cross-instance",
]);
const internals = new WeakMap();

function fail(message) {
  throw new TypeError(message);
}

function requireRuntimeKit(runtimeKit) {
  for (const name of REQUIRED_RUNTIME_KIT) if (typeof runtimeKit?.[name] !== "function") fail(`runtime-kit ${name} is required`);
}

function sameIdentity(left, right) {
  return ["deploymentId", "profileId", "generationId", "instanceId", "namespace"]
    .every(field => typeof left?.[field] === "string" && left[field] === right?.[field]);
}

export function createApplicationManager(options) {
  requireRuntimeKit(options?.runtimeKit);
  if (options.dshAdapter === null || typeof options.dshAdapter !== "object") fail("DSH rc2 adapter is required");
  if (options.trustVerifier === null || typeof options.trustVerifier !== "object") fail("runtime-kit trust verifier is required");
  if (typeof options.health !== "function") fail("runtime health adapter is required");
  const runtimeKit = options.runtimeKit;
  const store = runtimeKit.createMemoryRuntimeStore();
  const compositionService = runtimeKit.createCompositionService(options.composition ?? {});
  const rawManager = runtimeKit.createWorkloadManager({
    store,
    trustVerifier: options.trustVerifier,
    health: options.health,
    effects: options.dshAdapter.lifecycleEffects ?? {},
    compositionService,
  });
  const host = options.host ?? {};
  const hostService = runtimeKit.createMediatedHostService({
    store,
    trustVerifier: options.trustVerifier,
    authorize: host.authorize ?? (async () => ({ allowed: false, admissionSealDigest: "" })),
    effect: host.effect,
    broker: host.broker,
    journal: host.journal,
  });
  const facade = {};
  for (const operation of PUBLIC_MANAGER_OPERATIONS) {
    if (typeof rawManager[operation] !== "function") fail(`runtime-kit manager operation ${operation} is required`);
    Object.defineProperty(facade, operation, {
      enumerable: true,
      value: value => rawManager[operation](value),
    });
  }
  Object.freeze(facade);
  internals.set(facade, { rawManager, store, hostService, dshAdapter: options.dshAdapter, runtimeKit });
  return facade;
}

export function createApplicationControlService({ runtimeKit, manager, peers, nonceHighWater, reconcileEvidence }) {
  requireRuntimeKit(runtimeKit);
  const state = internals.get(manager);
  if (state === undefined || state.runtimeKit !== runtimeKit) fail("manager was not created by this runtime-kit boundary");
  if (typeof reconcileEvidence !== "function") fail("authenticated reconcile evidence resolver is required");
  return runtimeKit.createManagerControlService({
    manager: state.rawManager,
    peers,
    nonceHighWater,
    reconcileEvidence,
  });
}

export function createPluginSandbox({ runtimeKit, manager, dshAdapter }) {
  requireRuntimeKit(runtimeKit);
  const state = internals.get(manager);
  if (state === undefined || state.runtimeKit !== runtimeKit || state.dshAdapter !== dshAdapter) fail("plugin sandbox manager binding is invalid");
  if (typeof dshAdapter.executePlugin !== "function" || typeof dshAdapter.assertPluginConfinement !== "function") fail("DSH plugin sandbox adapter is required");
  const invoke = async value => {
    if (value === null || typeof value !== "object") fail("plugin invocation is required");
    const descriptor = definePlugin(runtimeKit, value.descriptor);
    const action = descriptor.actions.find(candidate => candidate.id === value.actionId);
    if (action === undefined) fail("plugin action is not declared");
    if (value.identity === null || typeof value.identity !== "object" || typeof value.identity.namespace !== "string") fail("plugin instance identity is required");
    const confinement = await dshAdapter.assertPluginConfinement(structuredClone(value.identity));
    if (confinement?.owner !== "DSH" || confinement.enforced !== true
      || confinement.namespace !== value.identity.namespace
      || confinement.generationId !== value.identity.generationId
      || typeof confinement.scopeRevision !== "string" || confinement.scopeRevision.length === 0
      || !Array.isArray(confinement.deniedAmbient)
      || REQUIRED_AMBIENT_DENIALS.some(name => !confinement.deniedAmbient.includes(name))) {
      fail("DSH plugin confinement is not current for this instance");
    }
    const hostAction = async request => {
      if (!sameIdentity(request?.identity, value.identity)) fail("mediated action identity does not match plugin instance");
      if (request.pluginId !== descriptor.metadata.id) fail("mediated action plugin does not match descriptor");
      if (request.actionId !== action.id) fail("mediated action does not match plugin action");
      if (request.pluginDescriptorDigest !== descriptor.metadata.digest) fail("mediated action descriptor digest does not match plugin");
      if (request.inputSchemaDigest !== action.inputSchemaDigest || request.outputSchemaDigest !== action.outputSchemaDigest) {
        fail("mediated action schemas do not match plugin action");
      }
      runtimeKit.validateMediatedHostActionRequest(request);
      return state.hostService.execute(request);
    };
    return dshAdapter.executePlugin(Object.freeze({
      descriptor,
      actionId: action.id,
      identity: structuredClone(value.identity),
      input: structuredClone(value.input),
      hostAction,
    }));
  };
  return Object.freeze({ invoke });
}
