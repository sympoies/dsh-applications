import { definePlugin, type PluginDescriptor, type RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const CODEX_SUBSCRIPTION_PLUGIN_VERSION = "0.1.4";
export const CODEX_SUBSCRIPTION_PLUGIN_TARBALL_DIGEST = "sha256:60a2a41b61f0d72420082e10ff0ba9b6048a2f52238bbfdeaa1a8031f4b5c3fe";
export const CODEX_SUBSCRIPTION_PLUGIN_SOURCE_REVISION = "c51ebcf6b351675fd9ef8ef9a88e3bd7742fcb58";
export const CODEX_SUBSCRIPTION_PLUGIN_ATTESTATION = "https://github.com/sympoies/dsh-plugins/.github/workflows/release.yml@refs/tags/dsh-llm-codex-subscription-v0.1.4";
export const CODEX_SUBSCRIPTION_PUBLIC_CONFIG_SCHEMA_DIGEST = "sha256:2743bd73726f204b1cbc0b7ad20a893329a46b01b732a8a74ddbcfcd9f0e63ca";
export const CODEX_SUBSCRIPTION_PROVIDER_ROUTE = "codex-subscription";

interface DescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): string;
}

function fail(message: string): never {
  throw new TypeError(message);
}

/** Build the runtime-kit descriptor for the reviewed native DSH provider. */
export function createCodexSubscriptionProviderDescriptor(runtimeKit: unknown): PluginDescriptor {
  const owner = runtimeKit as Partial<DescriptorOwner> | null | undefined;
  if (typeof owner?.computeDocumentDigest !== "function") {
    fail("runtime-kit computeDocumentDigest owner is required");
  }

  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: {
      id: "llm-codex-subscription",
      version: CODEX_SUBSCRIPTION_PLUGIN_VERSION,
      digest: `sha256:${"0".repeat(64)}`,
    },
    artifact: {
      package: "@sympoies/dsh-llm-codex-subscription",
      digest: CODEX_SUBSCRIPTION_PLUGIN_TARBALL_DIGEST,
      entrypoint: "lib/index.js",
      sourceRevision: CODEX_SUBSCRIPTION_PLUGIN_SOURCE_REVISION,
      attestationIdentity: CODEX_SUBSCRIPTION_PLUGIN_ATTESTATION,
    },
    compatibility: {
      dsh: "=0.1.6-alpha.2",
      runtimeKit: "=0.0.0",
      pluginApi: "=1.0.0",
      platforms: ["darwin-arm64", "linux-x64"],
    },
    capabilities: {
      provides: ["llm.provider.codex-subscription"],
      requires: [],
      tools: [],
      skills: [],
      services: ["dsh.llm"],
      dependencies: [],
    },
    actions: [],
    configuration: {
      schemaDigest: CODEX_SUBSCRIPTION_PUBLIC_CONFIG_SCHEMA_DIGEST,
      defaults: { route: CODEX_SUBSCRIPTION_PROVIDER_ROUTE },
    },
    mediation: {
      filesystem: [],
      network: ["codex-subscription-provider"],
      subprocess: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
      credentialHandleClasses: ["codex-subscription-token"],
    },
    health: { probes: [{ id: "llm-codex-subscription.ready", requirement: "required" }] },
    composition: {
      conflicts: [],
      cardinality: { min: 1, max: 1 },
      namespaceClaims: ["llm.provider.codex-subscription"],
      ordering: { before: [], after: [] },
    },
    lifecycle: {
      readiness: "required",
      interrupt: "supported",
      drain: "required",
      disposal: "required",
      recovery: "reconcile",
    },
  };
  descriptor.metadata.digest = owner.computeDocumentDigest(descriptor);
  return definePlugin(owner as RuntimeKitPluginValidator, descriptor as unknown as PluginDescriptor);
}
