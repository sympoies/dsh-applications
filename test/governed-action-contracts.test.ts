import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createApplicationManager, createPluginSandbox } from "./helpers/typed-manager.ts";
import { DIGEST, admitRunningPlugin, createOwnerRuntimeKit, identity } from "./helpers/owner-fixtures.ts";

import {
  GOVERNED_ACTION_SCHEMA_DIGESTS,
  type GovernedActionId,
  createAgentSessionPluginDescriptor,
  createAgentMemoryPluginDescriptor,
  createCalendarPluginDescriptor,
  createGroupNotesPluginDescriptor,
  createWorkRecommendationPluginDescriptor,
  validateAgentSessionReceipt,
  validateAgentSessionRequest,
  validateAgentMemoryReceipt,
  validateAgentMemoryRequest,
  validateCalendarReceipt,
  validateCalendarRequest,
  validateGroupNotesReceipt,
  validateGroupNotesRequest,
  validateWorkRecommendationReceipt,
  validateWorkRecommendationRequest,
} from "../packages/governed-action-contracts/src/index.ts";

const root = resolve(import.meta.dirname, "..");
const exactRoot = process.env.DSH_RUNTIME_KIT_ROOT
  ? resolve(process.env.DSH_RUNTIME_KIT_ROOT)
  : resolve(import.meta.dirname, "../../dsh-runtime-kit");
const exactRuntimeKitAvailable = existsSync(join(exactRoot, "src/composition/index.ts"));
const digestFile = (path: string) =>
  `sha256:${createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")}`;

const TEST_KEY = "public-owner-test-only";
const ref = (seed: string) => `ref:${createHmac("sha256", TEST_KEY).update(seed).digest("hex")}`;
const scope = (seed = "a") => ({
  deploymentRef: ref(`deployment-${seed}`),
  audienceRef: ref(`audience-${seed}`),
  conversationRef: ref(`conversation-${seed}`),
  targetRef: ref(`target-${seed}`),
});
const context = (seed = "a") => ({ scope: scope(seed), requestRef: ref(`request-${seed}`) });
const admitted = (owner: ReturnType<typeof context>, admittedAction: string) => ({
  ...owner, admittedAction: admittedAction as GovernedActionId,
});
const artifactIdentity = {
  digest: `sha256:${"4".repeat(64)}`,
  sourceRevision: "3".repeat(40),
  attestationIdentity: `https://github.com/sympoies/dsh-applications/actions@${"3".repeat(40)}`,
};

test("calendar read and every write mutation validate only inside the admitted opaque scope", () => {
  const owner = context();
  const read = {
    action: "organization.calendar.read",
    requestRef: owner.requestRef,
    scope: owner.scope,
    window: { startsAt: "2026-09-08T00:00:00Z", endsAt: "2026-09-09T00:00:00Z" },
    maxItems: 16,
  };
  assert.deepEqual(validateCalendarRequest(read, admitted(owner, read.action)), read);
  for (const mutation of [
    {
      kind: "create", title: "Planning", startsAt: "2026-09-08T02:00:00Z",
      endsAt: "2026-09-08T03:00:00Z", description: "Bounded", location: "Online",
    },
    { kind: "update", eventRef: ref("event"), patch: { title: "Updated" } },
    { kind: "delete", eventRef: ref("event") },
  ]) {
    const request = {
      action: "organization.calendar.write", requestRef: owner.requestRef,
      scope: owner.scope, mutation,
    };
    assert.deepEqual(validateCalendarRequest(request, admitted(owner, request.action)), request);
    assert.throws(
      () => validateCalendarRequest({ ...request, scope: scope("other") }, admitted(owner, request.action)),
      /scope/i,
      "every calendar mutation is audience and conversation bound",
    );
  }

  for (const candidate of [
    { ...read, scope: scope("other") },
    { ...read, scope: { ...owner.scope, targetRef: ref("substituted") } },
    { ...read, requestRef: ref("replay") },
    { ...read, providerIdentity: "google-personal" },
    { ...read, credential: "ambient" },
    { ...read, maxItems: 51 },
    { ...read, window: { startsAt: "not-time", endsAt: "2026-09-09T00:00:00Z" } },
  ]) assert.throws(
    () => validateCalendarRequest(candidate, admitted(owner, candidate.action as GovernedActionId)),
    /scope|target|request|unknown|items|time/i,
  );
});

test("calendar receipts stay bounded, correlated, immutable, and non-bearer", () => {
  const owner = context();
  const receipt = {
    action: "organization.calendar.read",
    requestRef: owner.requestRef,
    scope: owner.scope,
    outcome: "succeeded",
    summary: "2 events",
    events: [{ eventRef: ref("event-1"), title: "Planning", startsAt: "2026-09-08T02:00:00Z", endsAt: "2026-09-08T03:00:00Z" }],
  };
  const validated = validateCalendarReceipt(receipt, admitted(owner, receipt.action));
  assert(Object.isFrozen(validated));
  for (const candidate of [
    { ...receipt, requestRef: ref("other") },
    { ...receipt, scope: scope("other") },
    { ...receipt, accessToken: "forbidden" },
    { ...receipt, summary: "x".repeat(4097) },
    { ...receipt, events: Array.from({ length: 17 }, (_, index) => ({ ...receipt.events[0], eventRef: ref(String(index)) })) },
  ]) assert.throws(() => validateCalendarReceipt(candidate, admitted(owner, receipt.action)), /request|scope|unknown|summary|events/i);
});

test("group notes are conversation scoped and writes require an exact prior receipt", () => {
  const owner = context();
  const read = {
    action: "conversation.group-notes.read", requestRef: owner.requestRef,
    scope: owner.scope, limit: 8,
  };
  assert.deepEqual(validateGroupNotesRequest(read, admitted(owner, read.action)), read);
  const priorReceiptRef = ref("notes-prior");
  for (const mutation of [
    { kind: "upsert", expectedReceiptRef: priorReceiptRef, noteRef: ref("note"), title: "Decision", body: "Keep the target opaque." },
    { kind: "delete", expectedReceiptRef: priorReceiptRef, noteRef: ref("note") },
  ]) {
    const request = {
      action: "conversation.group-notes.write", requestRef: owner.requestRef,
      scope: owner.scope, mutation,
    };
    assert.deepEqual(validateGroupNotesRequest(request, {
      ...admitted(owner, request.action), expectedReceiptRef: priorReceiptRef,
    }), request);
    assert.throws(
      () => validateGroupNotesRequest(request, { ...admitted(owner, request.action), expectedReceiptRef: ref("stale") }),
      /receipt|stale/i,
    );
  }
  assert.throws(() => validateGroupNotesRequest({ ...read, scope: scope("other") }, admitted(owner, read.action)), /scope/i);
  assert.throws(() => validateGroupNotesRequest({ ...read, path: "/private/notes" }, admitted(owner, read.action)), /unknown/i);
});

test("group-note receipts reject cross-conversation and cross-request replay", () => {
  const owner = context();
  const receipt = {
    action: "conversation.group-notes.read", requestRef: owner.requestRef,
    scope: owner.scope, outcome: "succeeded", summary: "1 note", receiptRef: ref("notes-current"),
    priorReceiptRef: ref("notes-prior"),
    notes: [{ noteRef: ref("note"), title: "Decision", body: "Scoped note." }],
  };
  assert.deepEqual(validateGroupNotesReceipt(receipt, {
    ...admitted(owner, receipt.action), expectedPriorReceiptRef: receipt.priorReceiptRef,
  }), receipt);
  assert.throws(() => validateGroupNotesReceipt({ ...receipt, requestRef: ref("other") }, {
    ...admitted(owner, receipt.action), expectedPriorReceiptRef: receipt.priorReceiptRef,
  }), /request/i);
  assert.throws(() => validateGroupNotesReceipt({ ...receipt, scope: scope("other") }, {
    ...admitted(owner, receipt.action), expectedPriorReceiptRef: receipt.priorReceiptRef,
  }), /scope/i);
  assert.throws(() => validateGroupNotesReceipt(receipt, {
    ...admitted(owner, receipt.action), expectedPriorReceiptRef: ref("replayed") }), /receipt|replay/i);
});

test("work recommendation is read-only and bound to one admitted organization source", () => {
  const owner = context();
  const request = {
    action: "organization.work-recommendation.read", requestRef: owner.requestRef,
    scope: owner.scope, limit: 5, focus: "highest-value next step",
  };
  assert.deepEqual(validateWorkRecommendationRequest(request, admitted(owner, request.action)), request);
  const receipt = {
    action: request.action, requestRef: owner.requestRef, scope: owner.scope,
    outcome: "succeeded", summary: "1 recommendation",
    recommendations: [{ itemRef: ref("work-1"), title: "Finish review", rationale: "Unblocks release", rank: 1 }],
  };
  assert.deepEqual(validateWorkRecommendationReceipt(receipt, admitted(owner, request.action)), receipt);
  for (const candidate of [
    { ...request, action: "organization.work-recommendation.write" },
    { ...request, scope: scope("other") },
    { ...request, projectId: "private-project" },
  ]) assert.throws(
    () => validateWorkRecommendationRequest(candidate, admitted(owner, request.action)), /action|scope|unknown/i,
  );
});

test("external agent memory exposes bounded recall and candidate proposal without store authority", () => {
  const owner = context();
  const priorReceiptRef = ref("memory-prior");
  const recall = {
    action: "agent-memory.recall", requestRef: owner.requestRef, scope: owner.scope,
    query: "What did we decide about the rollout?", maxItems: 6,
  };
  assert.deepEqual(validateAgentMemoryRequest(recall, admitted(owner, recall.action)), recall);
  const proposal = {
    action: "agent-memory.candidate-add", requestRef: owner.requestRef, scope: owner.scope,
    expectedReceiptRef: priorReceiptRef,
    candidate: { summary: "Roll out with a single writer.", evidenceRefs: [ref("message-evidence")] },
  };
  assert.deepEqual(validateAgentMemoryRequest(proposal, {
    ...admitted(owner, proposal.action), expectedReceiptRef: priorReceiptRef,
  }), proposal);

  const receipt = {
    action: recall.action, requestRef: owner.requestRef, scope: owner.scope,
    outcome: "succeeded", summary: "1 memory", receiptRef: ref("memory-current"),
    priorReceiptRef, items: [{ memoryRef: ref("memory-1"), content: "Use a single writer.", relevance: 100 }],
  };
  assert.deepEqual(validateAgentMemoryReceipt(receipt, {
    ...admitted(owner, recall.action), expectedPriorReceiptRef: priorReceiptRef,
  }), receipt);
  for (const candidate of [
    { ...recall, scope: scope("other") },
    { ...recall, storePath: "/private/memory" },
    { ...proposal, expectedReceiptRef: ref("stale") },
    { ...proposal, commit: true },
  ]) assert.throws(
    () => validateAgentMemoryRequest(candidate, {
      ...admitted(owner, candidate.action), expectedReceiptRef: priorReceiptRef,
    }),
    /scope|unknown|receipt/i,
  );
});

test("agent-session actions require trusted workspace, exact session, and current receipt bindings", () => {
  const owner = context();
  const workspaceRef = ref("workspace");
  const sessionRef = ref("session");
  const priorReceiptRef = ref("agent-prior");
  const baseContext = { ...owner, workspaceRef, sessionRef, expectedReceiptRef: priorReceiptRef, currentState: "running" as const };
  const create = {
    action: "agent-session.create", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, prompt: "Implement the approved change.", timeoutSeconds: 900,
  };
  assert.deepEqual(validateAgentSessionRequest(create, {
    ...admitted(owner, create.action), workspaceRef,
  } as any), create);
  const requests = [
    { action: "agent-session.status", requestRef: owner.requestRef, scope: owner.scope, workspaceRef, sessionRef },
    {
      action: "agent-session.attach-metadata", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, sessionRef, expectedReceiptRef: priorReceiptRef,
      metadata: [{ key: "source.message", value: "opaque-message-ref" }],
    },
    {
      action: "agent-session.continue", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, sessionRef, expectedReceiptRef: priorReceiptRef,
      instruction: "Continue with the failing test.", timeoutSeconds: 600,
    },
    {
      action: "agent-session.cancel", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, sessionRef, expectedReceiptRef: priorReceiptRef, reason: "user-request",
    },
  ];
  for (const request of requests) assert.deepEqual(validateAgentSessionRequest(request, {
    ...baseContext, admittedAction: request.action,
  } as any), request);
  for (const request of requests) assert.throws(
    () => validateAgentSessionRequest({ ...request, scope: scope("other") }, {
      ...baseContext, admittedAction: request.action,
    } as any),
    /scope/i,
    `cross-conversation ${request.action} must fail closed`,
  );

  for (const candidate of [
    { ...create, workspaceRef: ref("invented-workspace") },
    { ...requests[2], sessionRef: ref("other-session") },
    { ...requests[2], expectedReceiptRef: ref("stale") },
    { ...requests[2], cwd: "/workspace/private" },
    { ...requests[2], credential: "ambient" },
    { ...requests[2], providerIdentity: "personal" },
    { ...requests[2], shell: "rm -rf anything" },
  ]) assert.throws(() => validateAgentSessionRequest(candidate, {
    ...baseContext, admittedAction: (candidate as { action: string }).action,
  } as any), /workspace|session|receipt|unknown/i);
});

test("terminal agent sessions allow status only and cancellation has exact terminal semantics", () => {
  const owner = context();
  const workspaceRef = ref("workspace");
  const sessionRef = ref("session");
  const expectedReceiptRef = ref("prior");
  const continueRequest = {
    action: "agent-session.continue", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef, expectedReceiptRef, instruction: "continue", timeoutSeconds: 60,
  };
  for (const currentState of ["succeeded", "failed", "cancelled", "timed-out"] as const) {
    assert.throws(() => validateAgentSessionRequest(continueRequest, {
      ...owner, admittedAction: "agent-session.continue" as const,
      workspaceRef, sessionRef, expectedReceiptRef, currentState,
    }), /terminal/i);
  }
  const cancelReceipt = {
    action: "agent-session.cancel", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef, receiptRef: ref("current"), priorReceiptRef: expectedReceiptRef,
    state: "cancelled", revision: "7", terminal: true, summary: "Cancelled by user.",
    recovery: { kind: "none" },
  };
  assert.deepEqual(validateAgentSessionReceipt(cancelReceipt, {
    ...owner, admittedAction: "agent-session.cancel" as const, workspaceRef, sessionRef,
    expectedPriorReceiptRef: expectedReceiptRef,
  }), cancelReceipt);
  assert.throws(() => validateAgentSessionReceipt({ ...cancelReceipt, state: "running", terminal: false }, {
    ...owner, admittedAction: "agent-session.cancel" as const, workspaceRef, sessionRef,
    expectedPriorReceiptRef: expectedReceiptRef,
  }), /cancel/i);
});

test("agent create mints its first session and receipt without pretending a prior receipt exists", () => {
  const owner = context();
  const workspaceRef = ref("workspace");
  const receipt = {
    action: "agent-session.create", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef: ref("new-session"), receiptRef: ref("first-receipt"),
    priorReceiptRef: null, state: "queued", revision: "0", terminal: false,
    summary: "Session created.", recovery: { kind: "none" },
  };
  assert.deepEqual(validateAgentSessionReceipt(receipt, {
    ...owner, admittedAction: "agent-session.create" as const, workspaceRef,
  }), receipt);
  assert.throws(() => validateAgentSessionReceipt({ ...receipt, priorReceiptRef: ref("invented-prior") }, {
    ...owner, admittedAction: "agent-session.create" as const, workspaceRef,
  }), /prior/i);
});

test("agent receipts encode timeout and restart recovery without permitting replay", () => {
  const owner = context();
  const workspaceRef = ref("workspace");
  const sessionRef = ref("session");
  const priorReceiptRef = ref("prior");
  const receipt = {
    action: "agent-session.status", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef, receiptRef: ref("current"), priorReceiptRef,
    state: "running", revision: "8", terminal: false, summary: "Recovered and running.",
    recovery: { kind: "resumed", fromReceiptRef: priorReceiptRef },
  };
  const receiptContext = {
    ...owner, admittedAction: "agent-session.status" as const, workspaceRef, sessionRef,
    expectedPriorReceiptRef: priorReceiptRef,
  };
  assert.deepEqual(validateAgentSessionReceipt(receipt, receiptContext), receipt);
  assert.throws(() => validateAgentSessionReceipt(receipt, {
    ...receiptContext, expectedPriorReceiptRef: ref("replayed-prior"),
  }), /receipt|replay/i);
  assert.throws(() => validateAgentSessionReceipt({
    ...receipt, state: "timed-out", terminal: false,
  }, receiptContext), /terminal|timed/i);
  assert.throws(() => validateAgentSessionReceipt({
    ...receipt, recovery: { kind: "resumed", fromReceiptRef: ref("other") },
  }, receiptContext), /recovery|receipt/i);
});

const ACTION_SCHEMA_SLUGS: Readonly<Record<GovernedActionId, string>> = {
  "organization.calendar.read": "calendar-read",
  "organization.calendar.write": "calendar-write",
  "conversation.group-notes.read": "group-notes-read",
  "conversation.group-notes.write": "group-notes-write",
  "organization.work-recommendation.read": "work-recommendation",
  "agent-memory.recall": "agent-memory-recall",
  "agent-memory.candidate-add": "agent-memory-candidate-add",
  "agent-session.create": "agent-session-create",
  "agent-session.status": "agent-session-status",
  "agent-session.attach-metadata": "agent-session-attach-metadata",
  "agent-session.continue": "agent-session-continue",
  "agent-session.cancel": "agent-session-cancel",
};

test("checked-in action schemas are unconditionally digest-bound", () => {
  for (const [action, digests] of Object.entries(GOVERNED_ACTION_SCHEMA_DIGESTS)) {
    const slug = ACTION_SCHEMA_SLUGS[action as GovernedActionId];
    assert.equal(digests.input, digestFile(`packages/governed-action-contracts/schemas/${slug}-request.schema.json`));
    assert.equal(digests.output, digestFile(`packages/governed-action-contracts/schemas/${slug}-receipt.schema.json`));
  }
});

test("every governed action descriptor shares the coordinated release version", () => {
  const runtimeKit: any = createOwnerRuntimeKit();
  runtimeKit.computeDocumentDigest = () => DIGEST;
  for (const createDescriptor of [
    createCalendarPluginDescriptor,
    createGroupNotesPluginDescriptor,
    createWorkRecommendationPluginDescriptor,
    createAgentSessionPluginDescriptor,
    createAgentMemoryPluginDescriptor,
  ]) {
    assert.equal(createDescriptor(runtimeKit, artifactIdentity).metadata.version, "0.7.0");
  }
});

test("exact-runtime descriptors keep each capability independently selectable", {
  skip: !exactRuntimeKitAvailable,
}, async () => {
  const runtimeKit = await import(pathToFileURL(join(exactRoot, "src/composition/index.ts")).href);
  const descriptors: any[] = [
    createCalendarPluginDescriptor(runtimeKit, artifactIdentity),
    createGroupNotesPluginDescriptor(runtimeKit, artifactIdentity),
    createWorkRecommendationPluginDescriptor(runtimeKit, artifactIdentity),
    createAgentSessionPluginDescriptor(runtimeKit, artifactIdentity),
    createAgentMemoryPluginDescriptor(runtimeKit, artifactIdentity),
  ];
  assert.deepEqual(descriptors.map(item => item.metadata.id), [
    "organization-calendar", "conversation-group-notes",
    "organization-work-recommendation", "governed-agent-session", "external-agent-memory",
  ]);
  assert.deepEqual(descriptors[3].actions.map((action: any) => action.id), [
    "agent-session.attach-metadata", "agent-session.cancel", "agent-session.continue",
    "agent-session.create", "agent-session.status",
  ]);
  for (const descriptor of descriptors) {
    assert.equal(descriptor.metadata.version, "0.7.0");
    assert.equal(descriptor.metadata.digest, runtimeKit.computeDocumentDigest(descriptor));
    assert.equal(descriptor.artifact.entrypoint, "packages/governed-action-contracts/src/index.ts");
    assert(Object.isFrozen(descriptor));
    assert.deepEqual(descriptor.mediation.filesystem, []);
    assert.deepEqual(descriptor.mediation.network, []);
    assert.deepEqual(descriptor.mediation.subprocess, []);
    assert.deepEqual(descriptor.mediation.credentialHandleClasses, []);
    assert.equal(
      new Set(descriptor.actions.map((action: any) => action.inputSchemaDigest)).size,
      descriptor.actions.length,
      `${descriptor.metadata.id} must bind each admitted action to its own input schema`,
    );
    assert.equal(
      new Set(descriptor.actions.map((action: any) => action.outputSchemaDigest)).size,
      descriptor.actions.length,
      `${descriptor.metadata.id} must bind each admitted action to its own output schema`,
    );
  }
  assert.equal(descriptors[0].actions.find((action: any) => action.id.endsWith(".write")).idempotency, "required");
  assert.equal(descriptors[2].actions.every((action: any) => action.class === "read"), true);
  assert.equal(descriptors[3].actions.find((action: any) => action.id === "agent-session.cancel").class, "destructive");
});

test("every mutation is a separately mediated, approval-deniable, replay-safe action", {
  skip: !exactRuntimeKitAvailable,
}, async () => {
  const runtimeKit = await import(pathToFileURL(join(exactRoot, "src/composition/index.ts")).href);
  const descriptors: any[] = [
    createCalendarPluginDescriptor(runtimeKit, artifactIdentity),
    createGroupNotesPluginDescriptor(runtimeKit, artifactIdentity),
    createAgentMemoryPluginDescriptor(runtimeKit, artifactIdentity),
    createAgentSessionPluginDescriptor(runtimeKit, artifactIdentity),
  ];
  const approvalClasses = new Set(["write", "destructive"]);
  const mutationActions = descriptors.flatMap(descriptor => descriptor.actions)
    .filter((action: any) => action.class !== "read");
  assert.deepEqual(mutationActions.map((action: any) => action.id).sort(), [
    "agent-memory.candidate-add", "agent-session.attach-metadata", "agent-session.cancel",
    "agent-session.continue", "agent-session.create", "conversation.group-notes.write",
    "organization.calendar.write",
  ]);
  for (const action of mutationActions) {
    assert(approvalClasses.has(action.class), `${action.id} must cross an approval-required class`);
    assert.equal(action.idempotency, "required", `${action.id} must use runtime-kit replay fencing`);
  }
  assert.equal(mutationActions.some((action: any) => action.id === "shell" || action.id.includes("terminal")), false);
});

test("every mutation schema and validator require the runtime idempotency identity", () => {
  const owner = context("idempotency");
  const workspaceRef = ref("workspace");
  const sessionRef = ref("session");
  const expectedReceiptRef = ref("prior");
  const cases = [
    ["calendar-write", validateCalendarRequest, {
      action: "organization.calendar.write", requestRef: owner.requestRef, scope: owner.scope,
      mutation: { kind: "delete", eventRef: ref("event") },
    }, admitted(owner, "organization.calendar.write")],
    ["group-notes-write", validateGroupNotesRequest, {
      action: "conversation.group-notes.write", requestRef: owner.requestRef, scope: owner.scope,
      mutation: { kind: "delete", expectedReceiptRef, noteRef: ref("note") },
    }, { ...admitted(owner, "conversation.group-notes.write"), expectedReceiptRef }],
    ["agent-memory-candidate-add", validateAgentMemoryRequest, {
      action: "agent-memory.candidate-add", requestRef: owner.requestRef, scope: owner.scope,
      expectedReceiptRef, candidate: { summary: "candidate", evidenceRefs: [] },
    }, { ...admitted(owner, "agent-memory.candidate-add"), expectedReceiptRef }],
    ["agent-session-create", validateAgentSessionRequest, {
      action: "agent-session.create", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, instruction: "start", timeoutSeconds: 60, metadata: {},
    }, { ...owner, admittedAction: "agent-session.create" as const, workspaceRef }],
    ["agent-session-attach-metadata", validateAgentSessionRequest, {
      action: "agent-session.attach-metadata", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, sessionRef, expectedReceiptRef, metadata: { phase: "test" },
    }, {
      ...owner, admittedAction: "agent-session.attach-metadata" as const,
      workspaceRef, sessionRef, expectedReceiptRef, currentState: "running" as const,
    }],
    ["agent-session-continue", validateAgentSessionRequest, {
      action: "agent-session.continue", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, sessionRef, expectedReceiptRef, instruction: "continue", timeoutSeconds: 60,
    }, {
      ...owner, admittedAction: "agent-session.continue" as const,
      workspaceRef, sessionRef, expectedReceiptRef, currentState: "running" as const,
    }],
    ["agent-session-cancel", validateAgentSessionRequest, {
      action: "agent-session.cancel", requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef, sessionRef, expectedReceiptRef, reason: "user-request",
    }, {
      ...owner, admittedAction: "agent-session.cancel" as const,
      workspaceRef, sessionRef, expectedReceiptRef, currentState: "running" as const,
    }],
  ] as const;
  for (const [slug, validator, request, expected] of cases) {
    const schema = JSON.parse(readFileSync(resolve(
      root, `packages/governed-action-contracts/schemas/${slug}-request.schema.json`,
    ), "utf8"));
    assert(schema.required.includes("requestRef"), `${slug} must require the idempotency identity`);
    assert.equal(schema.properties.requestRef.$ref, "#/$defs/ref");
    assert.match(schema.properties.requestRef.description, /MediatedHostActionRequest\.idempotencyKey/u);
    assert.throws(() => validator({ ...request, requestRef: undefined }, expected as any), /request/i);
    assert.throws(() => validator({ ...request, requestRef: ref("substituted") }, expected as any), /request/i);
  }
});

test("conversation-only profiles cannot discover or invoke organization or agent-session capabilities", () => {
  const forbidden = [
    "organization-calendar", "conversation-group-notes", "organization-work-recommendation",
    "governed-agent-session", "organization.calendar", "conversation.group-notes",
    "organization.work-recommendation", "agent-session.", "agent-memory.",
  ];
  for (const path of ["profiles/conversational/profile.json", "profiles/telegram-conversational/profile.json"]) {
    const content = readFileSync(resolve(root, path), "utf8");
    for (const marker of forbidden) assert.doesNotMatch(content, new RegExp(marker.replace(".", "\\.")));
  }
});

test("the admitted action rejects every sibling request shape", () => {
  const owner = context("admitted-action");
  const cases = [
    {
      validator: validateCalendarRequest,
      admittedAction: "organization.calendar.read",
      request: {
        action: "organization.calendar.write", requestRef: owner.requestRef, scope: owner.scope,
        mutation: { kind: "delete", eventRef: ref("event") },
      },
      expected: owner,
    },
    {
      validator: validateGroupNotesRequest,
      admittedAction: "conversation.group-notes.read",
      request: {
        action: "conversation.group-notes.write", requestRef: owner.requestRef, scope: owner.scope,
        mutation: {
          kind: "delete", expectedReceiptRef: ref("notes-prior"), noteRef: ref("note"),
        },
      },
      expected: { ...owner, expectedReceiptRef: ref("notes-prior") },
    },
    {
      validator: validateAgentMemoryRequest,
      admittedAction: "agent-memory.recall",
      request: {
        action: "agent-memory.candidate-add", requestRef: owner.requestRef, scope: owner.scope,
        expectedReceiptRef: ref("memory-prior"), candidate: { summary: "candidate", evidenceRefs: [] },
      },
      expected: { ...owner, expectedReceiptRef: ref("memory-prior") },
    },
    {
      validator: validateAgentSessionRequest,
      admittedAction: "agent-session.status",
      request: {
        action: "agent-session.continue", requestRef: owner.requestRef, scope: owner.scope,
        workspaceRef: ref("workspace"), sessionRef: ref("session"), expectedReceiptRef: ref("agent-prior"),
        instruction: "continue", timeoutSeconds: 60,
      },
      expected: {
        ...owner, workspaceRef: ref("workspace"), sessionRef: ref("session"),
        expectedReceiptRef: ref("agent-prior"), currentState: "running",
      },
    },
  ];
  for (const { validator, admittedAction, request, expected } of cases) {
    assert.throws(
      () => validator(request, { ...expected, admittedAction } as any),
      /admitted|action/i,
      `${admittedAction} must not accept ${request.action}`,
    );
  }
});

test("receipt validators reject actions from every other contract family", () => {
  const owner = context("receipt-family");
  const foreignAction = "organization.work-recommendation.read";
  const receiptContext = { ...owner, admittedAction: foreignAction };
  const cases = [
    [validateCalendarReceipt, {
      action: foreignAction, requestRef: owner.requestRef, scope: owner.scope,
      outcome: "succeeded", summary: "", events: [],
    }, receiptContext],
    [validateGroupNotesReceipt, {
      action: foreignAction, requestRef: owner.requestRef, scope: owner.scope,
      outcome: "succeeded", summary: "", receiptRef: ref("current"),
      priorReceiptRef: ref("prior"), notes: [],
    }, { ...receiptContext, expectedPriorReceiptRef: ref("prior") }],
    [validateAgentMemoryReceipt, {
      action: foreignAction, requestRef: owner.requestRef, scope: owner.scope,
      outcome: "succeeded", summary: "", receiptRef: ref("current"),
      priorReceiptRef: ref("prior"), items: [],
    }, { ...receiptContext, expectedPriorReceiptRef: ref("prior") }],
    [validateAgentSessionReceipt, {
      action: foreignAction, requestRef: owner.requestRef, scope: owner.scope,
      workspaceRef: ref("workspace"), sessionRef: ref("session"), receiptRef: ref("current"),
      priorReceiptRef: ref("prior"), state: "running", revision: "1", terminal: false,
      summary: "", recovery: { kind: "none" },
    }, {
      ...receiptContext, workspaceRef: ref("workspace"), sessionRef: ref("session"),
      expectedPriorReceiptRef: ref("prior"),
    }],
  ] as const;
  for (const [validator, receipt, expected] of cases) {
    assert.throws(() => validator(receipt, expected as any), /action|family/i);
  }
});

test("existing-session trust context fails closed when session or state evidence is missing", () => {
  const owner = context("session-context");
  const workspaceRef = ref("workspace");
  const sessionRef = ref("session");
  const expectedReceiptRef = ref("prior");
  const request = {
    action: "agent-session.continue", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef, expectedReceiptRef, instruction: "continue", timeoutSeconds: 60,
  };
  assert.throws(() => validateAgentSessionRequest(request, {
    ...owner, admittedAction: request.action, workspaceRef, sessionRef, expectedReceiptRef,
  } as any), /state/i);
  assert.throws(() => validateAgentSessionRequest(request, {
    ...owner, admittedAction: request.action, workspaceRef, sessionRef, expectedReceiptRef, currentState: "mystery",
  } as any), /state/i);

  const receipt = {
    action: "agent-session.status", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef, receiptRef: ref("current"), priorReceiptRef: expectedReceiptRef,
    state: "running", revision: "1", terminal: false, summary: "", recovery: { kind: "none" },
  };
  assert.throws(() => validateAgentSessionReceipt(receipt, {
    ...owner, admittedAction: receipt.action, workspaceRef, expectedPriorReceiptRef: expectedReceiptRef,
  } as any), /session/i);
  assert.throws(() => validateAgentSessionReceipt(receipt, {
    ...owner, admittedAction: "agent-session.status" as const,
    workspaceRef, sessionRef: ref("other-session"),
    expectedPriorReceiptRef: expectedReceiptRef,
  }), /session/i);
});

test("calendar timestamps reject impossible or out-of-range RFC 3339 components", () => {
  const owner = context("calendar-time");
  for (const startsAt of [
    "2026-02-31T00:00:00Z", "2025-02-29T00:00:00Z", "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:61Z",
    "2026-01-01T00:00:00+24:00",
  ]) {
    assert.throws(() => validateCalendarRequest({
      action: "organization.calendar.read", requestRef: owner.requestRef, scope: owner.scope,
      window: { startsAt, endsAt: "2027-01-01T00:00:00Z" }, maxItems: 1,
    }, admitted(owner, "organization.calendar.read")), /time|RFC|component/i, startsAt);
  }
  assert.doesNotThrow(() => validateCalendarRequest({
    action: "organization.calendar.read", requestRef: owner.requestRef, scope: owner.scope,
    window: { startsAt: "2024-02-29T23:59:59.123456789-23:59", endsAt: "2027-01-01T00:00:00Z" },
    maxItems: 1,
  }, admitted(owner, "organization.calendar.read")));
});

test("maximum multibyte calendar receipt crosses the application sandbox within its descriptor budget", async () => {
  const runtimeKit: any = createOwnerRuntimeKit();
  runtimeKit.computeDocumentDigest = () => DIGEST;
  const descriptor: any = createCalendarPluginDescriptor(runtimeKit, artifactIdentity);
  const instanceIdentity = identity("calendar-output");
  const owner = context("calendar-output");
  const receipt = validateCalendarReceipt({
    action: "organization.calendar.read", requestRef: owner.requestRef, scope: owner.scope,
    outcome: "succeeded", summary: "😀".repeat(4_096),
    events: Array.from({ length: 16 }, (_, index) => ({
      eventRef: ref(`event-${index}`), title: "😀".repeat(256),
      startsAt: "2026-09-08T00:00:00.123456789+23:59",
      endsAt: "2026-09-08T00:00:01.123456789+23:59",
      description: "😀".repeat(2_048), location: "😀".repeat(512),
    })),
  }, admitted(owner, "organization.calendar.read"));
  const admission = admitRunningPlugin(runtimeKit, instanceIdentity, descriptor);
  const dshAdapter = { lifecycleEffects: {}, async executePlugin() { return receipt; } };
  const manager = createApplicationManager({
    runtimeKit, runtimeStore: runtimeKit.store, dshAdapter, composition: {}, trustVerifier: {},
    health: async () => ({ state: "ready", code: "READY" }),
    host: { authorize: async () => ({ allowed: true, admissionSealDigest: "seal" }) },
  });
  const sandbox = createPluginSandbox({
    runtimeKit, manager, dshAdapter, admissionResolver: admission.admissionResolver,
    schemaOwner: admission.schemaOwner,
  });
  assert(Buffer.byteLength(JSON.stringify(receipt), "utf8") > 65_536);
  assert.deepEqual(await sandbox.invoke({
    pluginId: "organization-calendar", actionId: "organization.calendar.read",
    identity: instanceIdentity, input: {},
  }), receipt);
});

test("hosted exact-compatibility CI runs governed action descriptor contracts", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /DSH_RUNTIME_KIT_ROOT:[^\n]*\.\.\/dsh-runtime-kit[\s\S]*node --test test\/governed-action-contracts\.test\.ts/u);
});
