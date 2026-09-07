import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport, { type FormatsPlugin } from "ajv-formats";

import {
  ASSISTANT_READ_CAPABILITY_IDS,
  ASSISTANT_READ_CONTRACTS,
  ASSISTANT_READ_TRANSPORT_REQUIREMENTS,
  WEB_EXTRACT_TARGET_POLICY,
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
const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsImport as unknown as FormatsPlugin;
addFormats(ajv);
const schemaValidators = new Map<string, ReturnType<typeof ajv.compile>>();

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

function authorization(capabilityId: (typeof capabilityIds)[number]): any {
  return authorizeAssistantReadInvocation(admission(capabilityId), invocation(capabilityId));
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

function schemaValidator(capabilityId: (typeof capabilityIds)[number], direction: "input" | "output") {
  const contract = ASSISTANT_READ_CONTRACTS[capabilityId];
  const key = `${capabilityId}:${direction}`;
  const retained = schemaValidators.get(key);
  if (retained !== undefined) return retained;
  const compiled = ajv.compile(JSON.parse(readFileSync(
    resolve(root, `packages/assistant-read-contracts/schemas/${contract.schemaStem}.${direction}.schema.json`),
    "utf8",
  )));
  schemaValidators.set(key, compiled);
  return compiled;
}

test("six stable read contracts remain independently selectable and bounded", () => {
  assert.deepEqual(ASSISTANT_READ_CAPABILITY_IDS, capabilityIds);
  assert.deepEqual(ASSISTANT_READ_TRANSPORT_REQUIREMENTS, {
    rawBytesBeforeDecode: "required",
    decodedValueValidation: "required",
  });
  assert.deepEqual(WEB_EXTRACT_TARGET_POLICY, {
    protocols: ["http:", "https:"],
    credentialedUrls: "forbidden",
    literalAddresses: "forbidden",
    dnsResolution: "all-addresses-public-before-connect",
    redirects: "revalidate-each-hop",
    maxRedirects: 5,
  });
  assert(Object.isFrozen(WEB_EXTRACT_TARGET_POLICY.protocols));
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
    assert.equal(authorized.bindingDigest, TWO);
    assert.equal(authorized.admissionId, "admission-public-read-1");
    assert.equal(authorized.implementationDigest, ONE);
    assert.equal(authorized.audienceRef, "audience-bot-a");
    assert(Object.isFrozen(authorized));
    const validated = validateAssistantReadResult(authorized, result(capabilityId));
    assert.equal(validated.status, "completed");
    assert(Object.isFrozen(validated));
  }
});

test("exchange-rate and Web-extract branches have positive and negative ownership", () => {
  const market = "assistant.market.lookup";
  const marketAuthorized = authorizeAssistantReadInvocation(admission(market), invocation(market, {
    input: { kind: "exchange-rate", base: "USD", quotes: ["JPY", "TWD"] },
  }));
  const exchangeResult = {
    ...result(market),
    data: {
      quotes: [],
      exchangeRates: [{
        base: "USD",
        quote: "TWD",
        rate: 31.5,
        observedAt: "2026-09-08T00:00:00Z",
      }],
    },
  };
  assert.equal(validateAssistantReadResult(marketAuthorized, exchangeResult).status, "completed");
  assert.throws(
    () => validateAssistantReadResult(marketAuthorized, {
      ...exchangeResult,
      data: {
        quotes: [],
        exchangeRates: [{ ...exchangeResult.data.exchangeRates[0], base: "EUR" }],
      },
    }),
    /currency pair|authorized/i,
  );

  const web = "assistant.web.lookup";
  const webAuthorized = authorizeAssistantReadInvocation(admission(web), invocation(web, {
    input: {
      operation: "extract",
      url: "https://example.com/article",
      maxChars: 10,
    },
  }));
  const extractResult = {
    ...result(web),
    data: {
      results: [],
      extraction: {
        url: "https://example.com/article",
        title: "Article",
        text: "bounded",
        contentDigest: THREE,
      },
    },
  };
  assert.equal(validateAssistantReadResult(webAuthorized, extractResult).status, "completed");
  assert.throws(
    () => validateAssistantReadResult(webAuthorized, {
      ...extractResult,
      data: {
        ...extractResult.data,
        extraction: { ...extractResult.data.extraction, text: "over-limit!" },
      },
    }),
    /character limit|authorized/i,
  );
});

test("result validation enforces request output, source, and input-derived limits", () => {
  const weather = "assistant.weather.lookup";
  const contract = ASSISTANT_READ_CONTRACTS[weather];
  const narrowAdmission = admission(weather, {
    limits: {
      inputBytes: contract.budgets.inputBytes,
      outputBytes: 1_024,
      timeoutMs: contract.budgets.timeoutMs,
      sources: 1,
    },
  });
  const narrowAuthorized = authorizeAssistantReadInvocation(narrowAdmission, invocation(weather, {
    input: { location: "Taipei", units: "metric", days: 1 },
    control: {
      timeoutMs: contract.budgets.timeoutMs,
      maxOutputBytes: 1_024,
      maxSources: 1,
      cancellationRef: "cancel-narrow-weather",
    },
  }));
  assert.throws(
    () => validateAssistantReadResult(narrowAuthorized, {
      ...result(weather),
      summary: "x".repeat(2_000),
    }),
    /output|byte/i,
  );
  assert.throws(
    () => validateAssistantReadResult(narrowAuthorized, {
      ...result(weather),
      sources: [source(), source()],
    }),
    /source|authorized/i,
  );
  assert.throws(
    () => validateAssistantReadResult(narrowAuthorized, {
      ...result(weather),
      data: {
        ...result(weather).data,
        daily: [
          { date: "2026-09-08", low: 25, high: 31, condition: "rain" },
          { date: "2026-09-09", low: 24, high: 30, condition: "rain" },
        ],
      },
    }),
    /day count|authorized/i,
  );

  const market = "assistant.market.lookup";
  assert.throws(
    () => validateAssistantReadResult(authorization(market), {
      ...result(market),
      data: {
        quotes: [
          result(market).data.quotes[0],
          { ...result(market).data.quotes[0], symbol: "AAPL" },
        ],
        exchangeRates: [],
      },
    }),
    /symbols|authorized/i,
  );

  const steam = "assistant.steam.catalog.lookup";
  const narrowSteam = authorizeAssistantReadInvocation(admission(steam), invocation(steam, {
    input: { ...inputByCapability[steam], limit: 1 },
  }));
  assert.throws(
    () => validateAssistantReadResult(narrowSteam, {
      ...result(steam),
      data: {
        games: [
          result(steam).data.games[0],
          { ...result(steam).data.games[0], appId: 124 },
        ],
      },
    }),
    /result limit|authorized/i,
  );

  const web = "assistant.web.lookup";
  const narrowWeb = authorizeAssistantReadInvocation(admission(web), invocation(web, {
    input: { operation: "search", query: "public", limit: 1 },
  }));
  assert.throws(
    () => validateAssistantReadResult(narrowWeb, {
      ...result(web),
      data: {
        results: [
          result(web).data.results[0],
          { ...result(web).data.results[0], url: "https://example.org/second" },
        ],
        extraction: null,
      },
    }),
    /search limit|authorized/i,
  );

  for (const research of capabilityIds.slice(4)) {
    const narrowResearch = authorizeAssistantReadInvocation(admission(research), invocation(research, {
      input: { ...inputByCapability[research], maxFindings: 1 },
    }));
    const researchResult = result(research);
    assert.throws(
      () => validateAssistantReadResult(narrowResearch, {
        ...researchResult,
        data: {
          ...researchResult.data,
          findings: [
            researchResult.data.findings[0],
            { ...researchResult.data.findings[0], claim: "A second finding." },
          ],
        },
      }),
      /result limit|authorized/i,
    );
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
    () => validateAssistantReadResult(authorization(weather), { ...result(weather), summary: "x".repeat(100_000) }),
    /output|byte|long/i,
  );
  assert.throws(
    () => validateAssistantReadResult(authorization(weather), { ...result(weather), sources: Array.from({ length: ASSISTANT_READ_CONTRACTS[weather].budgets.sources + 1 }, source) }),
    /source|bounded/i,
  );
});

test("cancellation and timeout are explicit terminal outcomes and cannot carry stale data", () => {
  for (const capabilityId of capabilityIds.slice(4)) {
    const cancelled = { ...result(capabilityId), status: "cancelled", asOf: null, summary: "Cancelled by caller.", sources: [], data: null };
    const timedOut = { ...cancelled, status: "timed-out", summary: "Timed out." };
    assert.equal(validateAssistantReadResult(authorization(capabilityId), cancelled).status, "cancelled");
    assert.equal(validateAssistantReadResult(authorization(capabilityId), timedOut).status, "timed-out");
    assert.throws(
      () => validateAssistantReadResult(authorization(capabilityId), { ...cancelled, sources: [source()] }),
      /terminal|source|cancel/i,
    );
  }
});

test("strict output envelopes reject private bindings and unrelated state", () => {
  const weather = capabilityIds[0];
  for (const forbidden of ["bindingDigest", "credentialHandle", "privateConfigPath", "conversationState"]) {
    assert.throws(
      () => validateAssistantReadResult(authorization(weather), { ...result(weather), [forbidden]: "opaque" }),
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
    const configSchemaDigest = `sha256:${createHash("sha256")
      .update(readFileSync(resolve(root, "packages/assistant-read-contracts/schemas/public-config.schema.json")))
      .digest("hex")}`;
    assert.equal(descriptor.configuration.schemaDigest, configSchemaDigest);
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

test("Web extraction rejects literal non-public targets before broker execution", () => {
  const web = "assistant.web.lookup";
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://service.localhost/admin",
    "http://localhost./admin",
    "http://127.0.0.1/admin",
    "http://127.1/admin",
    "http://2130706433/admin",
    "http://0x7f000001/admin",
    "http://0177.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.0.1/",
    "http://[::1]/",
    "http://[fe80::1]/",
  ]) {
    assert.throws(
      () => authorizeAssistantReadInvocation(admission(web), invocation(web, {
        input: { operation: "extract", url, maxChars: 1_024 },
      })),
      /public|target|URL/i,
      url,
    );
  }
  assert.doesNotThrow(
    () => authorizeAssistantReadInvocation(admission(web), invocation(web, {
      input: { operation: "extract", url: "https://1password.com/", maxChars: 1_024 },
    })),
  );
});

test("calendar validation rejects normalized impossible dates", () => {
  const research = "assistant.research.recent-community";
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(research), invocation(research, {
      input: {
        ...inputByCapability[research],
        since: "2026-02-01T00:00:00Z",
        until: "2026-02-30T00:00:00Z",
      },
    })),
    /timestamp|calendar|date/i,
  );

  const weather = "assistant.weather.lookup";
  assert.throws(
    () => validateAssistantReadResult(authorization(weather), {
      ...result(weather),
      asOf: "2026-02-30T00:00:00Z",
    }),
    /timestamp|calendar|date/i,
  );
  assert.throws(
    () => validateAssistantReadResult(authorization(weather), {
      ...result(weather),
      sources: [{ ...source(), retrievedAt: "2026-02-30T00:00:00Z" }],
    }),
    /timestamp|calendar|date/i,
  );
  assert.throws(
    () => validateAssistantReadResult(authorization(weather), {
      ...result(weather),
      data: {
        ...result(weather).data,
        daily: [{ date: "2026-02-30", low: 1, high: 2, condition: "rain" }],
      },
    }),
    /timestamp|calendar|date/i,
  );
});

test("authorization retains immutable admission and target-binding context", () => {
  const weather = "assistant.weather.lookup";
  const authorized: any = authorizeAssistantReadInvocation(admission(weather), invocation(weather));
  assert.equal(authorized.admissionId, "admission-public-read-1");
  assert.equal(authorized.implementationDigest, ONE);
  assert.equal(authorized.bindingDigest, TWO);
  assert.equal(authorized.audienceRef, "audience-bot-a");
  assert(Object.isFrozen(authorized.control));
  assert(Object.isFrozen(authorized.input));
  assert.throws(() => { authorized.bindingDigest = THREE; });
});

test("completed freshness timestamps are chronological", () => {
  const weather = "assistant.weather.lookup";
  assert.throws(
    () => validateAssistantReadResult(authorization(weather), {
      ...result(weather),
      asOf: "2026-09-08T00:00:00Z",
      sources: [{
        ...source(),
        publishedAt: "2026-09-08T00:00:01Z",
        retrievedAt: "2026-09-08T00:00:02Z",
      }],
    }),
    /fresh|chronolog|published|retrieved|asOf/i,
  );
  assert.throws(
    () => validateAssistantReadResult(authorization(weather), {
      ...result(weather),
      asOf: "2026-09-08T00:00:03Z",
      sources: [{
        ...source(),
        publishedAt: "2026-09-08T00:00:02Z",
        retrievedAt: "2026-09-08T00:00:01Z",
      }],
    }),
    /publishedAt.*retrievedAt/i,
  );

  const market = "assistant.market.lookup";
  assert.throws(
    () => validateAssistantReadResult(authorization(market), {
      ...result(market),
      data: {
        ...result(market).data,
        quotes: [{ ...result(market).data.quotes[0], observedAt: "2026-09-08T00:00:01Z" }],
      },
    }),
    /observedAt.*asOf/i,
  );
  const steam = "assistant.steam.catalog.lookup";
  assert.throws(
    () => validateAssistantReadResult(authorization(steam), {
      ...result(steam),
      data: {
        games: [{ ...result(steam).data.games[0], observedAt: "2026-09-08T00:00:01Z" }],
      },
    }),
    /observedAt.*asOf/i,
  );
});

test("JSON Schemas and direct validators conform on expressible constraints", () => {
  for (const capabilityId of capabilityIds) {
    assert.equal(schemaValidator(capabilityId, "input")(inputByCapability[capabilityId]), true);
    assert.equal(schemaValidator(capabilityId, "output")(result(capabilityId)), true);
  }

  const web = "assistant.web.lookup";
  for (const url of [
    "file:///etc/passwd",
    "http://user:password@example.com/",
    "http://localhost/",
    "http://service.localhost/",
    "http://localhost./",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://[::1]/",
    "http://127%2e0%2e0%2e1/",
    "http://%31%32%37.0.0.1/",
    "http://localhost%2e/",
    "http://localhos%74/",
  ]) {
    const candidate = { operation: "extract", url, maxChars: 100 };
    assert.equal(schemaValidator(web, "input")(candidate), false, url);
    assert.throws(
      () => authorizeAssistantReadInvocation(admission(web), invocation(web, { input: candidate })),
      /URL|public|target/i,
    );
  }
  const publicNumericName = { operation: "extract", url: "https://1password.com/", maxChars: 100 };
  assert.equal(schemaValidator(web, "input")(publicNumericName), true);
  assert.doesNotThrow(
    () => authorizeAssistantReadInvocation(admission(web), invocation(web, { input: publicNumericName })),
  );
  const publicEncodedPath = {
    operation: "extract",
    url: "https://example.com/a%20public%20path?q=one%2Ftwo",
    maxChars: 100,
  };
  assert.equal(schemaValidator(web, "input")(publicEncodedPath), true);
  assert.doesNotThrow(
    () => authorizeAssistantReadInvocation(admission(web), invocation(web, { input: publicEncodedPath })),
  );

  const research = "assistant.research.recent-community";
  const unsortedResearch = {
    ...inputByCapability[research],
    sourceClasses: ["social", "community"],
  };
  assert.equal(schemaValidator(research, "input")(unsortedResearch), true);
  assert.doesNotThrow(
    () => authorizeAssistantReadInvocation(admission(research), invocation(research, { input: unsortedResearch })),
  );
  const unsortedSourceIndexes = {
    ...result(research),
    sources: [
      source(),
      { ...source(), url: "https://example.org/second-source" },
    ],
    data: {
      ...result(research).data,
      findings: [{ ...result(research).data.findings[0], sourceIndexes: [1, 0] }],
    },
  };
  assert.equal(schemaValidator(research, "output")(unsortedSourceIndexes), true);
  assert.doesNotThrow(
    () => validateAssistantReadResult(authorization(research), unsortedSourceIndexes),
  );

  const invalidCalendar = {
    ...inputByCapability[research],
    since: "2026-02-01T00:00:00Z",
    until: "2026-02-30T00:00:00Z",
  };
  assert.equal(schemaValidator(research, "input")(invalidCalendar), false);
  assert.throws(
    () => authorizeAssistantReadInvocation(admission(research), invocation(research, { input: invalidCalendar })),
    /timestamp|calendar|date/i,
  );

  const cancelledWithData = {
    ...result(web),
    status: "cancelled",
    asOf: null,
  };
  assert.equal(schemaValidator(web, "output")(cancelledWithData), false);
  assert.throws(
    () => validateAssistantReadResult(authorization(web), cancelledWithData),
    /terminal|cancel/i,
  );

  const credentialSource = {
    ...result(web),
    sources: [{ ...source(), url: "https://user:password@example.com/source" }],
  };
  assert.equal(schemaValidator(web, "output")(credentialSource), false);
  assert.throws(
    () => validateAssistantReadResult(authorization(web), credentialSource),
    /credential|URL/i,
  );
});

test("wide input stops before eager descriptor aggregation", () => {
  const weather = "assistant.weather.lookup";
  const wide = Object.fromEntries(Array.from({ length: 3_000 }, (_, index) => [`field${index}`, index]));
  const original = Object.getOwnPropertyDescriptors;
  Object.getOwnPropertyDescriptors = () => {
    throw new Error("eager descriptor aggregation");
  };
  try {
    assert.throws(
      () => authorizeAssistantReadInvocation(admission(weather), {
        ...invocation(weather),
        input: wide,
      }),
      /item limit/i,
    );
  } finally {
    Object.getOwnPropertyDescriptors = original;
  }
});
