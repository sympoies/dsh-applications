import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  AGENT_SESSION_RECEIPT_SCHEMA_DIGEST,
  AGENT_SESSION_REQUEST_SCHEMA_DIGEST,
  AGENT_MEMORY_RECEIPT_SCHEMA_DIGEST,
  AGENT_MEMORY_REQUEST_SCHEMA_DIGEST,
  CALENDAR_RECEIPT_SCHEMA_DIGEST,
  CALENDAR_REQUEST_SCHEMA_DIGEST,
  GROUP_NOTES_RECEIPT_SCHEMA_DIGEST,
  GROUP_NOTES_REQUEST_SCHEMA_DIGEST,
  WORK_RECOMMENDATION_RECEIPT_SCHEMA_DIGEST,
  WORK_RECOMMENDATION_REQUEST_SCHEMA_DIGEST,
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
  assert.deepEqual(validateCalendarRequest(read, owner), read);
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
    assert.deepEqual(validateCalendarRequest(request, owner), request);
    assert.throws(
      () => validateCalendarRequest({ ...request, scope: scope("other") }, owner),
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
  ]) assert.throws(() => validateCalendarRequest(candidate, owner), /scope|target|request|unknown|items|time/i);
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
  const validated = validateCalendarReceipt(receipt, { ...owner, action: receipt.action });
  assert(Object.isFrozen(validated));
  for (const candidate of [
    { ...receipt, requestRef: ref("other") },
    { ...receipt, scope: scope("other") },
    { ...receipt, accessToken: "forbidden" },
    { ...receipt, summary: "x".repeat(4097) },
    { ...receipt, events: Array.from({ length: 17 }, (_, index) => ({ ...receipt.events[0], eventRef: ref(String(index)) })) },
  ]) assert.throws(() => validateCalendarReceipt(candidate, { ...owner, action: receipt.action }), /request|scope|unknown|summary|events/i);
});

test("group notes are conversation scoped and writes require an exact prior receipt", () => {
  const owner = context();
  const read = {
    action: "conversation.group-notes.read", requestRef: owner.requestRef,
    scope: owner.scope, limit: 8,
  };
  assert.deepEqual(validateGroupNotesRequest(read, owner), read);
  const priorReceiptRef = ref("notes-prior");
  for (const mutation of [
    { kind: "upsert", expectedReceiptRef: priorReceiptRef, noteRef: ref("note"), title: "Decision", body: "Keep the target opaque." },
    { kind: "delete", expectedReceiptRef: priorReceiptRef, noteRef: ref("note") },
  ]) {
    const request = {
      action: "conversation.group-notes.write", requestRef: owner.requestRef,
      scope: owner.scope, mutation,
    };
    assert.deepEqual(validateGroupNotesRequest(request, { ...owner, expectedReceiptRef: priorReceiptRef }), request);
    assert.throws(
      () => validateGroupNotesRequest(request, { ...owner, expectedReceiptRef: ref("stale") }),
      /receipt|stale/i,
    );
  }
  assert.throws(() => validateGroupNotesRequest({ ...read, scope: scope("other") }, owner), /scope/i);
  assert.throws(() => validateGroupNotesRequest({ ...read, path: "/private/notes" }, owner), /unknown/i);
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
    ...owner, action: receipt.action, expectedPriorReceiptRef: receipt.priorReceiptRef,
  }), receipt);
  assert.throws(() => validateGroupNotesReceipt({ ...receipt, requestRef: ref("other") }, {
    ...owner, action: receipt.action, expectedPriorReceiptRef: receipt.priorReceiptRef,
  }), /request/i);
  assert.throws(() => validateGroupNotesReceipt({ ...receipt, scope: scope("other") }, {
    ...owner, action: receipt.action, expectedPriorReceiptRef: receipt.priorReceiptRef,
  }), /scope/i);
  assert.throws(() => validateGroupNotesReceipt(receipt, {
    ...owner, action: receipt.action, expectedPriorReceiptRef: ref("replayed") }), /receipt|replay/i);
});

test("work recommendation is read-only and bound to one admitted organization source", () => {
  const owner = context();
  const request = {
    action: "organization.work-recommendation.read", requestRef: owner.requestRef,
    scope: owner.scope, limit: 5, focus: "highest-value next step",
  };
  assert.deepEqual(validateWorkRecommendationRequest(request, owner), request);
  const receipt = {
    action: request.action, requestRef: owner.requestRef, scope: owner.scope,
    outcome: "succeeded", summary: "1 recommendation",
    recommendations: [{ itemRef: ref("work-1"), title: "Finish review", rationale: "Unblocks release", rank: 1 }],
  };
  assert.deepEqual(validateWorkRecommendationReceipt(receipt, { ...owner, action: request.action }), receipt);
  for (const candidate of [
    { ...request, action: "organization.work-recommendation.write" },
    { ...request, scope: scope("other") },
    { ...request, projectId: "private-project" },
  ]) assert.throws(() => validateWorkRecommendationRequest(candidate, owner), /action|scope|unknown/i);
});

test("external agent memory exposes bounded recall and candidate proposal without store authority", () => {
  const owner = context();
  const priorReceiptRef = ref("memory-prior");
  const recall = {
    action: "agent-memory.recall", requestRef: owner.requestRef, scope: owner.scope,
    query: "What did we decide about the rollout?", maxItems: 6,
  };
  assert.deepEqual(validateAgentMemoryRequest(recall, owner), recall);
  const proposal = {
    action: "agent-memory.candidate-add", requestRef: owner.requestRef, scope: owner.scope,
    expectedReceiptRef: priorReceiptRef,
    candidate: { summary: "Roll out with a single writer.", evidenceRefs: [ref("message-evidence")] },
  };
  assert.deepEqual(validateAgentMemoryRequest(proposal, { ...owner, expectedReceiptRef: priorReceiptRef }), proposal);

  const receipt = {
    action: recall.action, requestRef: owner.requestRef, scope: owner.scope,
    outcome: "succeeded", summary: "1 memory", receiptRef: ref("memory-current"),
    priorReceiptRef, items: [{ memoryRef: ref("memory-1"), content: "Use a single writer.", relevance: 100 }],
  };
  assert.deepEqual(validateAgentMemoryReceipt(receipt, {
    ...owner, action: recall.action, expectedPriorReceiptRef: priorReceiptRef,
  }), receipt);
  for (const candidate of [
    { ...recall, scope: scope("other") },
    { ...recall, storePath: "/private/memory" },
    { ...proposal, expectedReceiptRef: ref("stale") },
    { ...proposal, commit: true },
  ]) assert.throws(
    () => validateAgentMemoryRequest(candidate, { ...owner, expectedReceiptRef: priorReceiptRef }),
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
  assert.deepEqual(validateAgentSessionRequest(create, { ...owner, workspaceRef }), create);
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
  for (const request of requests) assert.deepEqual(validateAgentSessionRequest(request, baseContext), request);
  for (const request of requests) assert.throws(
    () => validateAgentSessionRequest({ ...request, scope: scope("other") }, baseContext),
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
  ]) assert.throws(() => validateAgentSessionRequest(candidate, baseContext), /workspace|session|receipt|unknown/i);
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
      ...owner, workspaceRef, sessionRef, expectedReceiptRef, currentState,
    }), /terminal/i);
  }
  const cancelReceipt = {
    action: "agent-session.cancel", requestRef: owner.requestRef, scope: owner.scope,
    workspaceRef, sessionRef, receiptRef: ref("current"), priorReceiptRef: expectedReceiptRef,
    state: "cancelled", revision: "7", terminal: true, summary: "Cancelled by user.",
    recovery: { kind: "none" },
  };
  assert.deepEqual(validateAgentSessionReceipt(cancelReceipt, {
    ...owner, workspaceRef, sessionRef, action: cancelReceipt.action,
    expectedPriorReceiptRef: expectedReceiptRef,
  }), cancelReceipt);
  assert.throws(() => validateAgentSessionReceipt({ ...cancelReceipt, state: "running", terminal: false }, {
    ...owner, workspaceRef, sessionRef, action: cancelReceipt.action,
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
    ...owner, workspaceRef, action: receipt.action,
  }), receipt);
  assert.throws(() => validateAgentSessionReceipt({ ...receipt, priorReceiptRef: ref("invented-prior") }, {
    ...owner, workspaceRef, action: receipt.action,
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
    ...owner, workspaceRef, sessionRef, action: receipt.action,
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

test("checked-in schemas are digest-bound and descriptors keep each capability independently selectable", {
  skip: !exactRuntimeKitAvailable,
}, async () => {
  const pairs = [
    [CALENDAR_REQUEST_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/calendar-request.schema.json"],
    [CALENDAR_RECEIPT_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/calendar-receipt.schema.json"],
    [GROUP_NOTES_REQUEST_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/group-notes-request.schema.json"],
    [GROUP_NOTES_RECEIPT_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/group-notes-receipt.schema.json"],
    [WORK_RECOMMENDATION_REQUEST_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/work-recommendation-request.schema.json"],
    [WORK_RECOMMENDATION_RECEIPT_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/work-recommendation-receipt.schema.json"],
    [AGENT_SESSION_REQUEST_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/agent-session-request.schema.json"],
    [AGENT_SESSION_RECEIPT_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/agent-session-receipt.schema.json"],
    [AGENT_MEMORY_REQUEST_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/agent-memory-request.schema.json"],
    [AGENT_MEMORY_RECEIPT_SCHEMA_DIGEST, "packages/governed-action-contracts/schemas/agent-memory-receipt.schema.json"],
  ] as const;
  for (const [actual, path] of pairs) assert.equal(actual, digestFile(path));

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
    assert.equal(descriptor.metadata.digest, runtimeKit.computeDocumentDigest(descriptor));
    assert.equal(descriptor.artifact.entrypoint, "packages/governed-action-contracts/src/index.ts");
    assert(Object.isFrozen(descriptor));
    assert.deepEqual(descriptor.mediation.filesystem, []);
    assert.deepEqual(descriptor.mediation.network, []);
    assert.deepEqual(descriptor.mediation.subprocess, []);
    assert.deepEqual(descriptor.mediation.credentialHandleClasses, []);
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
