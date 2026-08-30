import type { PluginDescriptor, RuntimeKitPluginValidator } from "@sympoies/dsh-plugin-sdk";

export const GITHUB_REVIEW_TRIGGER_SCHEMA_DIGEST: `sha256:${string}`;
export const GITHUB_PULL_REQUEST_READ_BUNDLE_SCHEMA_DIGEST: `sha256:${string}`;

export interface ImmutableGitHubPluginArtifactIdentity {
  readonly digest: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly attestationIdentity: string;
}

export interface RuntimeKitPluginDescriptorOwner extends RuntimeKitPluginValidator {
  computeDocumentDigest(value: unknown): `sha256:${string}`;
}

export interface GitHubReviewBinding {
  readonly capsuleDigest: `sha256:${string}`;
  readonly requestId: string;
  readonly target: string;
  readonly headSha: string;
  readonly pathSetDigest: `sha256:${string}`;
  readonly generation: string;
  readonly instance: string;
  readonly outputSchemaDigest: `sha256:${string}`;
  readonly admissionId: string;
  readonly publisherEpoch: string;
}

export interface GitHubPullRequestReadBundle extends GitHubReviewBinding {
  readonly trigger:
    | { readonly kind: "pull-request-opened" }
    | { readonly kind: "review-command"; readonly command: "@mes_bot review" };
  readonly pullRequest: { readonly title: string; readonly body: string };
  readonly files: readonly { readonly path: string; readonly lines: readonly number[] }[];
  readonly threads: readonly {
    readonly path: string;
    readonly line: number;
    readonly author: string;
    readonly body: string;
  }[];
}

export function validateGitHubPullRequestReadBundle(input: unknown): Readonly<GitHubPullRequestReadBundle>;
export function isCompatibilityReviewTrigger(trigger: unknown): boolean;
export function createGitHubReadPluginDescriptor(
  runtimeKit: RuntimeKitPluginDescriptorOwner,
  artifactIdentity: ImmutableGitHubPluginArtifactIdentity,
): Readonly<PluginDescriptor>;
