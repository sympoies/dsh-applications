import { definePlugin, type PluginDescriptor, type RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const TELEGRAM_PLUGIN_VERSION = "0.5.1";
export const TELEGRAM_PLUGIN_TARBALL_DIGEST = "sha256:a41aa5300eb0b0a25b33c162e843955eac8450c8a71446ba5c7f68623b61ea4b";
export const TELEGRAM_PLUGIN_SOURCE_REVISION = "596ef74b4fb9536aaae9981035240be4ef8a9acd";
export const TELEGRAM_PLUGIN_ATTESTATION = "https://github.com/ashafizullah/dsh-telegram/.github/workflows/release.yml@refs/tags/v0.5.1";
export const TELEGRAM_PUBLIC_CONFIG_SCHEMA_DIGEST = "sha256:91b024d728e80f3b9a75aff52de1a9dbba5b0c0db42f1a9bcd90bc81970a734f";

interface DescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): string;
}

function fail(message: string): never {
  throw new TypeError(message);
}

/**
 * Build the runtime-kit descriptor for the one reviewed external Telegram
 * artifact. No caller-controlled value can replace its package, version,
 * digest, source revision, mediation classes, or disabled public default.
 */
export function createTelegramChannelPluginDescriptor(runtimeKit: unknown): unknown {
  const owner = runtimeKit as Partial<DescriptorOwner> | null | undefined;
  if (typeof owner?.computeDocumentDigest !== "function") {
    fail("runtime-kit computeDocumentDigest owner is required");
  }

  const descriptor = {
    apiVersion: "runtime.sympoies.dev/v1",
    kind: "PluginDescriptor",
    metadata: {
      id: "telegram-channel",
      version: TELEGRAM_PLUGIN_VERSION,
      digest: `sha256:${"0".repeat(64)}`,
    },
    artifact: {
      package: "@ashafizullah/dsh-telegram",
      digest: TELEGRAM_PLUGIN_TARBALL_DIGEST,
      entrypoint: "lib/index.js",
      sourceRevision: TELEGRAM_PLUGIN_SOURCE_REVISION,
      attestationIdentity: TELEGRAM_PLUGIN_ATTESTATION,
    },
    compatibility: {
      dsh: "=0.1.1-rc.2",
      runtimeKit: "=0.0.0",
      pluginApi: "=1.0.0",
      platforms: ["linux-x64"],
    },
    capabilities: {
      provides: ["channel.telegram.ingress", "channel.telegram.reply"],
      requires: ["conversation.memory", "conversation.reply"],
      tools: [],
      skills: [],
      services: ["dsh.agents", "dsh.credentials"],
      dependencies: [{ id: "conversation-agent", range: ">=0.3.0 <1.0.0", scope: "required" }],
    },
    actions: [],
    configuration: {
      schemaDigest: TELEGRAM_PUBLIC_CONFIG_SCHEMA_DIGEST,
      defaults: {
        enabled: false,
        media: { enabled: false, ocr: { enabled: false } },
        screenshot: { enabled: false },
      },
    },
    mediation: {
      filesystem: ["instance-state"],
      network: ["telegram-api"],
      subprocess: [],
      resources: { cpuClass: "shared", memoryMb: 128, outputBytes: 65_536 },
      credentialHandleClasses: ["telegram-bot-token"],
    },
    health: { probes: [{ id: "telegram-channel.ready", requirement: "required" }] },
    composition: {
      conflicts: [],
      cardinality: { min: 1, max: 1 },
      namespaceClaims: ["channel.telegram"],
      ordering: { before: [], after: ["conversation-agent"] },
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
