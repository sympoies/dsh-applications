import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import {
  createDshRc2Adapter,
  type DshHostSandboxOwner,
  type DshRc2Confinement,
  type DshRc2Identity,
  type DshRc2InstanceRuntime,
} from "@sympoies/dsh-rc2-adapter";
import {
  createApplicationManager,
  createPluginSandbox,
  type LockedPluginAdmission,
  type RuntimeKitBoundary,
  type RuntimeStore,
} from "@sympoies/dsh-manager";
import {
  defineConfiguration,
  defineHealth,
  defineOutput,
  definePlugin,
  defineSandbox,
  defineTrigger,
  type PluginActionDescriptor,
  type PluginDescriptor,
} from "@sympoies/dsh-plugin-sdk";

declare const ctx: Context;
declare const runtimeKit: RuntimeKitBoundary;
declare const store: RuntimeStore;
declare const identity: DshRc2Identity;
declare const sessionId: SessionId;
declare const agent: Agent;
declare const tools: ToolRuntime;

const configuration = defineConfiguration({
  schemaDigest: "sha256:configuration",
  defaults: { enabled: true },
});
const health = defineHealth({ probes: [{ id: "ready", requirement: "required" }] });
const sandbox = defineSandbox({
  filesystem: ["workspace:read"],
  network: [],
  subprocess: [],
  credentialHandleClasses: [],
  resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 4096 },
});
const trigger = defineTrigger({
  id: "manual",
  class: "manual",
  inputSchemaDigest: "sha256:input",
});
const output = defineOutput({ id: "result", schemaDigest: "sha256:output" });

const descriptor = definePlugin(runtimeKit, {
  apiVersion: "runtime.sympoies.dev/v1",
  kind: "PluginDescriptor",
  metadata: { id: "review", version: "1.0.0", digest: "sha256:descriptor" },
  artifact: {
    package: "@example/review",
    digest: "sha256:artifact",
    entrypoint: "./index.js",
    sourceRevision: "revision",
    attestationIdentity: "build@example",
  },
  compatibility: {
    dsh: "0.1.1-rc.2",
    runtimeKit: "0.0.0",
    pluginApi: "runtime.sympoies.dev/v1",
    platforms: ["linux-x64"],
  },
  capabilities: {
    provides: ["review"], requires: [], tools: [], skills: [], services: [], dependencies: [],
  },
  actions: [{
    id: "comment",
    class: "write",
    inputSchemaDigest: trigger.inputSchemaDigest,
    outputSchemaDigest: output.schemaDigest,
    sideEffect: "idempotent",
    idempotency: "required",
    capability: "review",
  }],
  configuration,
  mediation: sandbox,
  health,
  composition: {
    conflicts: [], cardinality: { min: 1, max: 1 }, namespaceClaims: ["review"],
    ordering: { before: [], after: [] },
  },
  lifecycle: {
    readiness: "required", interrupt: "supported", drain: "required",
    disposal: "required", recovery: "reconcile",
  },
} satisfies PluginDescriptor);

const confinement: DshRc2Confinement = {
  owner: "DSH/host",
  enforced: true,
  identity,
  sessionId,
  root: "/workspace/review",
  agentId: agent.id,
  scopeRevision: "scope-1",
  deniedAmbient: ["filesystem", "network", "subprocess"],
};

const hostSandbox: DshHostSandboxOwner<{ readonly agent: Agent }> = {
  bind: ({ agent: boundAgent }) => ({ agent: boundAgent as Agent }),
  assertCurrent: () => confinement,
  execute: async () => null,
};

const instanceRuntime: DshRc2InstanceRuntime = {
  sessionId,
  root: "/workspace/review",
  memory: {}, queue: {}, credentialHandles: {}, budget: {}, concurrencyController: {},
  configureScope(agentContext) {
    const exact = agentContext as Context;
    void exact.tools;
  },
};

const adapter = createDshRc2Adapter({ ctx, resolveInstanceRuntime: () => instanceRuntime, hostSandbox });
const manager = createApplicationManager({
  runtimeKit,
  runtimeStore: store,
  dshAdapter: adapter,
  trustVerifier: {},
  health: async () => ({ healthy: true }),
});
const admission: LockedPluginAdmission = {
  descriptor,
  descriptorDigest: descriptor.metadata.digest,
  artifactDigest: descriptor.artifact.digest,
  resolvedCompositionDigest: "sha256:composition",
  compositionLockReceiptDigest: "sha256:receipt",
  admissionSealDigest: "sha256:seal",
};
createPluginSandbox({
  runtimeKit,
  manager,
  dshAdapter: adapter,
  admissionResolver: () => admission,
  schemaOwner: { resolve: digest => ({ digest, validate: () => undefined }) },
});

void tools;

// @ts-expect-error Plugin actions are constrained to the runtime-kit vocabulary.
const invalidActionClass: PluginActionDescriptor["class"] = "shell";
// @ts-expect-error Schema identities must be canonical sha256 digests.
defineOutput({ id: "invalid", schemaDigest: "output" });
void invalidActionClass;
