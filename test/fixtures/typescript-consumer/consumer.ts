// A downstream TypeScript consumer of every workspace package. The
// repository-contract test compiles this file with compiler options the
// workspace itself does not use, so the shipped `.ts` sources stay compilable
// under a stricter consumer configuration without the optional DSH peers.
import type { Context } from "@deepseek-ai/cordis";
import {
  createConversationAgentPluginDescriptor,
  validateConversationReply,
  validateConversationTurn,
  type ConversationTurn,
} from "@sympoies/dsh-conversation-agent";
import {
  createDshRc2Adapter,
  REQUIRED_AMBIENT_DENIALS,
  type DshHostSandboxOwner,
  type DshRc2InstanceRuntime,
} from "@sympoies/dsh-rc2-adapter";
import {
  createGitHubReadPluginDescriptor,
  isCompatibilityReviewTrigger,
  validateGitHubPullRequestReadBundle,
  type GitHubPullRequestReadBundle,
} from "@sympoies/dsh-github-read";
import {
  createGitHubReviewWorkerResult,
  validateGitHubReviewWorkerResult,
  MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES,
  type GitHubReviewWorkerResult,
} from "@sympoies/dsh-github-review-publish";
import {
  createApplicationManager,
  createPluginSandbox,
  DEFAULT_PLUGIN_PAYLOAD_LIMITS,
  PUBLIC_MANAGER_OPERATIONS,
  type PublicApplicationManager,
  type RuntimeKitBoundary,
  type RuntimeStore,
} from "@sympoies/dsh-application-manager";
import {
  defineDigest,
  definePlugin,
  defineTrigger,
  type PluginDescriptor,
  type Sha256Digest,
} from "@sympoies/dsh-plugin-sdk";

declare const ctx: Context;
declare const runtimeKit: RuntimeKitBoundary;
declare const store: RuntimeStore;
declare const runtime: DshRc2InstanceRuntime;
declare const hostSandbox: DshHostSandboxOwner<{ readonly bound: true }>;
declare const bundle: GitHubPullRequestReadBundle;
declare const result: GitHubReviewWorkerResult;
declare const descriptor: PluginDescriptor;

const digest: Sha256Digest = defineDigest(`sha256:${"0".repeat(64)}`);
const trigger = defineTrigger({ id: "manual", class: "manual", inputSchemaDigest: digest });
const manualClass: "manual" = trigger.class;

const adapter = createDshRc2Adapter({ ctx, resolveInstanceRuntime: () => runtime, hostSandbox });
const manager: PublicApplicationManager = createApplicationManager({
  runtimeKit,
  runtimeStore: store,
  dshAdapter: adapter,
  trustVerifier: {},
  health: async () => ({ healthy: true }),
});
const sandbox = createPluginSandbox({
  runtimeKit,
  manager,
  dshAdapter: adapter,
  admissionResolver: () => ({
    descriptor,
    descriptorDigest: digest,
    artifactDigest: digest,
    resolvedCompositionDigest: digest,
    compositionLockReceiptDigest: digest,
    admissionSealDigest: digest,
  }),
  schemaOwner: { resolve: schemaDigest => ({ digest: schemaDigest, validate: () => undefined }) },
});

const turn: ConversationTurn = validateConversationTurn({ message: "hello" });
const reply = validateConversationReply({ reply: "hi" });
const bundleCopy = validateGitHubPullRequestReadBundle(bundle);
const verified = validateGitHubReviewWorkerResult(result, { readBundle: bundleCopy });
const created = createGitHubReviewWorkerResult({ binding: bundleCopy, output: verified.output, readBundle: undefined });
const limit: 65536 = MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES;
const firstOperation: "validate" = PUBLIC_MANAGER_OPERATIONS[0];
const firstDenial: "env" = REQUIRED_AMBIENT_DENIALS[0];

void definePlugin(runtimeKit, descriptor);
void createGitHubReadPluginDescriptor;
void createConversationAgentPluginDescriptor;
void isCompatibilityReviewTrigger(bundleCopy.trigger);
void DEFAULT_PLUGIN_PAYLOAD_LIMITS.inputBytes;
void sandbox;
void turn;
void reply;
void created;
void limit;
void manualClass;
void firstOperation;
void firstDenial;
