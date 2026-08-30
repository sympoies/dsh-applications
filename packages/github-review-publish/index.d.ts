import type {
  GitHubPullRequestReadBundle,
  GitHubReviewBinding,
  ImmutableGitHubPluginArtifactIdentity,
  RuntimeKitPluginDescriptorOwner,
} from "@sympoies/dsh-github-read";
import type { PluginDescriptor } from "@sympoies/dsh-plugin-sdk";

export const GITHUB_REVIEW_OUTPUT_DIGEST_DOMAIN: "sympoies/github-review-output/v1";
export const GITHUB_REVIEW_WORKER_RESULT_DIGEST_DOMAIN: "sympoies/github-review-worker-result/v1";
export const GITHUB_REVIEW_OUTPUT_MEDIA_TYPE: "application/vnd.sympoies.github-review+json";
export const GITHUB_REVIEW_OUTPUT_SCHEMA_DIGEST: `sha256:${string}`;
export const GITHUB_REVIEW_WORKER_RESULT_SCHEMA_DIGEST: `sha256:${string}`;
export const MAX_GITHUB_REVIEW_WORKER_RESULT_BYTES: 65536;

export interface GitHubReviewOutput {
  readonly decision: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  readonly reviewReport: {
    readonly format: "agent-kit.specialist-review-report.v1";
    readonly body: string;
  };
  readonly inlineComments: readonly {
    readonly path: string;
    readonly line: number;
    readonly body: string;
    readonly suggestion?: string;
  }[];
}

export interface GitHubReviewWorkerResult extends GitHubReviewBinding {
  readonly apiVersion: "runtime.sympoies.dev/v1";
  readonly kind: "GitHubReviewWorkerResult";
  readonly digest: `sha256:${string}`;
  readonly outputMediaType: "application/vnd.sympoies.github-review+json";
  readonly outputByteLength: number;
  readonly output: GitHubReviewOutput;
  readonly outputDigest: `sha256:${string}`;
}

export function canonicalizeGitHubReviewJson(value: unknown): string;
export function computeGitHubReviewOutputDigest(output: unknown): `sha256:${string}`;
export function computeGitHubReviewWorkerResultDigest(result: unknown): `sha256:${string}`;
export function validateGitHubReviewWorkerResult(input: unknown, options?: {
  readonly readBundle?: GitHubPullRequestReadBundle;
}): Readonly<GitHubReviewWorkerResult>;
export function createGitHubReviewWorkerResult(input: {
  readonly binding: GitHubReviewBinding;
  readonly output: GitHubReviewOutput;
  readonly readBundle?: GitHubPullRequestReadBundle;
}): Readonly<GitHubReviewWorkerResult>;
export function createGitHubReviewPublishPluginDescriptor(
  runtimeKit: RuntimeKitPluginDescriptorOwner,
  artifactIdentity: ImmutableGitHubPluginArtifactIdentity,
): Readonly<PluginDescriptor>;
