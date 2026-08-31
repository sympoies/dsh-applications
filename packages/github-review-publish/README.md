# GitHub review publish contracts

This public package constructs and validates the Phase-0
`runtime.sympoies.dev/v1` `GitHubReviewWorkerResult`. The result carries one
complete structured Review Report plus at most 50 native path/line comments or
suggestions. Structured findings carry an explicit boolean actionability,
stable fingerprint, and exact line or file location. Before any provider
effect, the validator requires a one-to-one fingerprint and location match
between every actionable finding and a native comment; missing, extra,
duplicate, or mismatched mappings fail closed, while non-actionable findings
remain report-only. The contract never parses Review Report Markdown or infers
actionability from severity. The output is validated against the immutable
`profiles/github-pr-review/output.schema.json`, serialized as UTF-8 RFC 8785
JCS, limited to 65,536 bytes, and bound by its byte length, schema digest,
output digest, and complete worker-result digest.
The worker-result schema constrains `outputSchemaDigest` to that exact output
schema digest, so revising the referenced output contract necessarily changes
the worker-result schema identity as well.

The output digest preimage is
`ASCII("sympoies/github-review-output/v1") || 0x00 || canonical-output-bytes`.
The worker-result digest uses
`ASCII("sympoies/github-review-worker-result/v1") || 0x00 || JCS(result
without digest)`.

The worker result is deliberately non-bearer: its exact schema has no capsule
handle, credential handle, broker token, provider credential, caller-selected
target fields, external output locator, or provider client. The opaque target
and all remaining identities are broker-issued values echoed from the admitted
binding. The authenticated supervisor's private completion envelope is owned
by infrastructure and is never exposed to this package, DSH, a plugin, the
public manager, model context, or logs. Provider reconciliation and writes use
only the private broker transaction.

`createGitHubReviewPublishPluginDescriptor` constructs the corresponding
release-bound `github-review-publish` descriptor. It declares the required
`github-read` dependency and idempotent mediated publish action while retaining
empty ambient network and credential-handle requirements. Runtime-kit remains
the descriptor schema and canonical-digest owner.
