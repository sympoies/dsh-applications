import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  ASSISTANT_READ_CAPABILITY_IDS,
  ASSISTANT_READ_CONTRACTS,
  authorizeAssistantReadInvocation,
  createAssistantReadPluginDescriptor,
  validateAssistantReadResult,
} from "../packages/assistant-read-contracts/src/index.ts";
import { createOwnerRuntimeKit } from "./helpers/owner-fixtures.ts";

const root = resolve(import.meta.dirname, "..");
const exactRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactRuntimeKitAvailable = existsSync(join(exactRoot, "src/composition/index.js"));
const ONE = `sha256:${"1".repeat(64)}` as const;
const TWO = `sha256:${"2".repeat(64)}` as const;
const THREE = `sha256:${"3".repeat(64)}` as const;

const capabilityIds = [
  "assistant.weather.lookup",
  "assistant.market.lookup",
  "assistant.steam.catalog.lookup",
  "assistant.web.lookup",
  "assistant.research.recent-community",
  "assistant.research.taiwan-public-discussion",
] as const;

const inputByCapability: Record<(typeof capabilityIds)[number], any> = {
  "assistant.weather.lookup": { location: "Taipei", units: "metric", days: 3 },
  "assistant.market.lookup": { kind: "quote", symbols: ["2330.TW"] },
  "assistant.steam.catalog.lookup": { query: "co-op", countryCode: "TW", currency: "TWD", limit: 5 },
  "assistant.web.lookup": { operation: "search", query: "public release notes", limit: 5 },
  "assistant.research.recent-community": {
    topic: "developer reactions",
    since: "2026-08-10T00:00:00Z",
    until: "2026-09-08T00:00:00Z",
    sourceClasses: ["community", "news", "social"],
    maxFindings: 12,
  },
  "assistant.research.taiwan-public-discussion": {
    topic: "public transit discussion",
    since: "2026-08-25T00:00:00Z",
    until: "2026-09-08T00:00:00Z",
    locale: "zh-TW",
    sourceClasses: ["forum", "news", "social"],
    maxFindings: 12,
  },
};

function admission(capabilityId: (typeof capabilityIds)[number], overrides: Record<string, unknown> = {}): any {
  const contract = ASSISTANT_READ_CONTRACTS[capabilityId];
  return {
    admissionId: "admission-public-read-1",
    capabilityId,
    implementationDigest: ONE,
    bindingDigest: TWO,
    audienceRefs: ["audience-bot-a"],
    limits: {
      inputBytes: contract.budgets.inputBytes,
      outputBytes: contract.budgets.outputBytes,
      timeoutMs: contract.budgets.timeoutMs,
      sources: contract.budgets.sources,
    },
    ...overrides,
  };
}

function invocation(capabilityId: (typeof capabilityIds)[number], overrides: Record<string, unknown> = {}): any {
  const contract = ASSISTANT_READ_CONTRACTS[capabilityId];
  return {
    capabilityId,
    requestId: "read-request-1",
    implementationDigest: ONE,
    audienceRef: "audience-bot-a",
    input: structuredClone(inputByCapability[capabilityId]),
    control: {
      timeoutMs: contract.budgets.timeoutMs,
      maxOutputBytes: contract.budgets.outputBytes,
      maxSources: contract.budgets.sources,
      cancellationRef: "cancel-read-request-1",
    },
    ...overrides,
  };
}

function source() {
  return {
    url: "https://example.com/public-source",
    title: "Public source",
    retrievedAt: "2026-09-08T00:00:00Z",
    publishedAt: "2026-09-07T12:00:00Z",
    contentDigest: THREE,
  };
}

function result(capabilityId: (typeof capabilityIds)[number]): any {
  const common = {
    status: "completed",
    asOf: "2026-09-08T00:00:00Z",
    summary: "Bounded public result.",
    sources: [source()],
  };
  switch (capabilityId) {
    case "assistant.weather.lookup":
      return { ...common, data: { location: "Taipei", units: "metric", current: { temperature: 29, condition: "cloudy" }, daily: [{ date: "2026-09-08", low: 25, high: 31, condition: "rain" }] } };
    case "assistant.market.lookup":
      return { ...common, data: { quotes: [{ symbol: "2330.TW", currency: "TWD", price: 999, observedAt: "2026-09-08T00:00:00Z" }], exchangeRates: [] } };
    case "assistant.steam.catalog.lookup":
      return { ...common, data: { games: [{ appId: 123, name: "Example Game", currency: "TWD", finalPrice: 399, originalPrice: 599, discountPercent: 33, observedAt: "2026-09-08T00:00:00Z", storeUrl: "https://store.steampowered.com/app/123" }] } };
    case "assistant.web.lookup":
      return { ...common, data: { results: [{ url: "https://example.com/public-source", title: "Public source", excerpt: "A bounded excerpt." }], extraction: null } };
    case "assistant.research.recent-community":
      return { ...common, data: { window: { since: "2026-08-10T00:00:00Z", until: "2026-09-08T00:00:00Z" }, findings: [{ claim: "A visible discussion theme.", sourceIndexes: [0], confidence: "medium" }], themes: ["tooling"] } };
    case "assistant.research.taiwan-public-discussion":
      return { ...common, data: { locale: "zh-TW", window: { since: "2026-08-25T00:00:00Z", until: "2026-09-08T00:00:00Z" }, findings: [{ claim: "A visible Taiwan discussion theme.", sourceIndexes: [0], confidence: "medium" }], trends: [{ label: "public-transit", direction: "mixed", sourceIndexes: [0] }] } };
  }
}

test("six stable read contracts remain independently selectable and bounded", () => {
  assert.deepEqual(ASSISTANT_READ_CAPABILITY_IDS, capabilityIds);
  for (const capabilityId of capabilityIds) {
    const contract = ASSISTANT_READ_CONTRACTS[capabilityId];
    assert.equal(contract.id, capabilityId);
    assert.deepEqual(contract.hostActionClasses, ["provider-read"]);
    assert.equal(contract.networkClasses.length, 1);
    assert(!contract.networkClasses.includes("network"));
    assert(contract.budgets.timeoutMs > 0);
    assert(contract.budgets.inputBytes > 0);
    assert(contract.budgets.outputBytes > 0);
    assert(contract.budgets.sources > 0);
    assert.equal(contract.cancellation, "required");
    assert.equal(contract.freshness, "required");
    assert(Object.isFrozen(contract));
  }
});

test("every contract accepts its positive invocation and result", () => {
  for (const capabilityId of capabilityIds) {
    const authorized = authorizeAssistantReadInvocation(admission(capabilityId), invocation(capabilityId));
    assert.deepEqual(authorized.input, inputByCapability[capabilityId]);
    assert.equal(authorized.capabilityId, capabilityId);
    assert.equal(authorized.control.maxSources, ASSISTANT_READ_CONTRACTS[capabilityId].budgets.sources);
    assert.equal((authorized as Record<string, unknown>).bindingDigest, undefined);
    assert(Object.isFrozen(authorized));
    const validated = validateAssistantReadResult(capabilityId, result(capabilityId));
    assert.equal(validated.status, "completed");
    assert(Object.isFrozen(validated));
  }
});

test("unadmitted capability, wrong implementation, and wrong audience fail closed", () => {
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(capabilityIds[0]), invocation(capabilityIds[1])),
    /capability|admitted/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(capabilityIds[0]), invocation(capabilityIds[0], { implementationDigest: THREE })),
    /implementation/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(capabilityIds[0]), invocation(capabilityIds[0], { audienceRef: "audience-bot-b" })),
    /audience/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(capabilityIds[0]), {
      ...invocation(capabilityIds[0]),
      networkClass: "ambient-network",
    }),
    /unknown field networkClass/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(capabilityIds[0]), invocation(capabilityIds[0], {
      control: {
        timeoutMs: 1_000,
        maxOutputBytes: 4_096,
        maxSources: 1,
      },
    })),
    /cancellationRef.*required/i,
  );
});

test("input, output, source, and timeout ceilings reject excess", () => {
  const weather = capabilityIds[0];
  assert.doesNotThrow(
    () => authorizeAssistantReadInvocation(admission(weather), invocation(weather, {
      input: { location: "天".repeat(256), units: "metric", days: 1 },
    })),
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(weather), invocation(weather, {
      input: { location: "天".repeat(257), units: "metric", days: 1 },
    })),
    /long/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(weather), invocation(weather, { input: { location: "x".repeat(10_000), units: "metric", days: 1 } })),
    /input|byte|long/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(weather), invocation(weather, { control: { ...invocation(weather).control, timeoutMs: ASSISTANT_READ_CONTRACTS[weather].budgets.timeoutMs + 1 } })),
    /timeout/i,
  );
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(weather, { limits: { ...admission(weather).limits, sources: 1 } }), invocation(weather)),
    /source/i,
  );
  assert.throws(
    () => validateAssistantReadResult(weather, { ...result(weather), summary: "x".repeat(100_000) }),
    /output|byte|long/i,
  );
  assert.throws(
    () => validateAssistantReadResult(weather, { ...result(weather), sources: Array.from({ length: ASSISTANT_READ_CONTRACTS[weather].budgets.sources + 1 }, source) }),
    /source|bounded/i,
  );
});

test("cancellation and timeout are explicit terminal outcomes and cannot carry stale data", () => {
  for (const capabilityId of capabilityIds.slice(4)) {
    const cancelled = { ...result(capabilityId), status: "cancelled", asOf: null, summary: "Cancelled by caller.", sources: [], data: null };
    const timedOut = { ...cancelled, status: "timed-out", summary: "Timed out." };
    assert.equal(validateAssistantReadResult(capabilityId, cancelled).status, "cancelled");
    assert.equal(validateAssistantReadResult(capabilityId, timedOut).status, "timed-out");
    assert.throws(
      () => validateAssistantReadResult(capabilityId, { ...cancelled, sources: [source()] }),
      /terminal|source|cancel/i,
    );
  }
});

test("strict output envelopes reject private bindings and unrelated state", () => {
  const weather = capabilityIds[0];
  for (const forbidden of ["bindingDigest", "credentialHandle", "privateConfigPath", "conversationState"]) {
    assert.throws(
      () => validateAssistantReadResult(weather, { ...result(weather), [forbidden]: "opaque" }),
      new RegExp(`unknown field ${forbidden}`, "i"),
    );
  }
});

test("same contract supports separate bot implementation slots without cross-admission", () => {
  const capabilityId = capabilityIds[0];
  const botA = admission(capabilityId);
  const botB = admission(capabilityId, {
    admissionId: "admission-public-read-2",
    implementationDigest: THREE,
    bindingDigest: ONE,
    audienceRefs: ["audience-bot-b"],
  });
  assert.doesNotThrow(() => authorizeAssistantReadInvocation(botA, invocation(capabilityId)));
  assert.doesNotThrow(() => authorizeAssistantReadInvocation(botB, invocation(capabilityId, {
    requestId: "read-request-2",
    implementationDigest: THREE,
    audienceRef: "audience-bot-b",
  })));
  assert.throws(
    () => authorizeAssistantReadInvocation(botA, invocation(capabilityId, { implementationDigest: THREE })),
    /implementation/i,
  );
});

test("each capability creates one separately admitted read descriptor with no ambient authority", () => {
  const runtimeKit = {
    ...createOwnerRuntimeKit(),
    computeDocumentDigest() { return ONE; },
  };
  for (const capabilityId of capabilityIds) {
    const descriptor: any = createAssistantReadPluginDescriptor(runtimeKit, capabilityId, {
      digest: ONE,
      sourceRevision: "a".repeat(40),
      attestationIdentity: "https://github.com/sympoies/dsh-applications/.github/workflows/release.yml@refs/tags/v0.4.0",
    });
    const contract = ASSISTANT_READ_CONTRACTS[capabilityId];
    assert.equal(descriptor.metadata.id, contract.pluginId);
    assert.equal(descriptor.artifact.package, "@sympoies/dsh-assistant-read-contracts");
    assert.deepEqual(descriptor.capabilities.provides, [capabilityId]);
    assert.deepEqual(descriptor.actions.map((action: any) => action.id), [contract.actionId]);
    assert.equal(descriptor.actions[0].class, "read");
    assert.equal(descriptor.actions[0].sideEffect, "none");
    assert.deepEqual(descriptor.mediation.filesystem, []);
    assert.deepEqual(descriptor.mediation.subprocess, []);
    assert.deepEqual(descriptor.mediation.credentialHandleClasses, []);
    assert.deepEqual(descriptor.mediation.network, contract.networkClasses);
    assert.deepEqual(descriptor.capabilities.dependencies, []);
    assert.deepEqual(descriptor.configuration.defaults, { enabled: false });
    assert(Object.isFrozen(descriptor));
    assert.throws(() => descriptor.mediation.network.push("ambient-network"));
  }
  assert.throws(
    () => createAssistantReadPluginDescriptor(runtimeKit, capabilityIds[0], {
      digest: ONE,
      sourceRevision: "a".repeat(40),
      attestationIdentity: "https://github.com/sympoies/dsh-applications/.github/workflows/release.yml@refs/tags/v0.4.0",
      credentialHandleClasses: ["provider-secret"],
    } as any),
    /unknown field credentialHandleClasses/i,
  );
});

test("all six descriptors validate with the exact locked runtime-kit owner", { skip: !exactRuntimeKitAvailable }, async () => {
  const runtimeKit = await import(pathToFileURL(join(exactRoot, "src/composition/index.js")).href);
  for (const capabilityId of capabilityIds) {
    const descriptor = createAssistantReadPluginDescriptor(runtimeKit, capabilityId, {
      digest: ONE,
      sourceRevision: "a".repeat(40),
      attestationIdentity: "https://github.com/sympoies/dsh-applications/.github/workflows/release.yml@refs/tags/v0.4.0",
    });
    assert.equal(runtimeKit.validatePluginDescriptor(descriptor), descriptor);
  }
});

test("schema identities bind all checked-in strict contracts", () => {
  for (const capabilityId of capabilityIds) {
    const contract = ASSISTANT_READ_CONTRACTS[capabilityId];
    const fileDigest = (file: string) => `sha256:${createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex")}`;
    assert.equal(contract.inputSchemaDigest, fileDigest(`packages/assistant-read-contracts/schemas/${contract.schemaStem}.input.schema.json`));
    assert.equal(contract.outputSchemaDigest, fileDigest(`packages/assistant-read-contracts/schemas/${contract.schemaStem}.output.schema.json`));
  }
});

test("public contract source has no implementation client or private authority path", () => {
  const sourceText = readFileSync(resolve(root, "packages/assistant-read-contracts/src/index.ts"), "utf8");
  assert.doesNotMatch(sourceText, /local-scripts|serenvia|process\.env|child_process|node:fs|fetch\(|axios|subprocess-template|filesystem-(?:read|write)|network-connect/i);
});
