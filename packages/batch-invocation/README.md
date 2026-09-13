# Batch invocation contract

`@sympoies/dsh-batch-invocation` defines the portable byte boundary between a
host trigger and one admitted DSH batch application. It does not start DSH,
schedule work, hold credentials, or perform provider actions.

The caller creates one request containing an immutable application identity,
exact schema digests, an invocation identity, an attempt number, and bounded
JSON input. The package canonicalizes the request and input, then validates one
terminal result against the exact request and a digest of the complete
application identity. Unknown fields, non-canonical bytes, digest drift,
cross-invocation or cross-schema results, incomplete outputs, and unsupported
terminal outcomes fail closed.

`invokeBatch` accepts an owner-supplied callback. Infrastructure may connect
that callback to an authenticated runtime-kit/DSH adapter on Linux or macOS;
the callback receives canonical UTF-8 bytes and must return canonical result
bytes. Runtime-kit remains the owner of lifecycle state, admission, overlap,
retry receipts, recovery, and DSH execution.

Terminal results distinguish success, invalid input/output, timeout,
cancellation, model unavailability, overlap refusal, and interrupted recovery.
The contract marks only retry-safe terminal classes as retryable. A retry keeps
the invocation and input identity while incrementing the bounded attempt.

The schemas describe the public wire shape. The TypeScript validators are the
executable contract and additionally enforce canonical digests and byte limits.
`BATCH_INVOCATION_REQUEST_SCHEMA_DIGEST` and
`BATCH_INVOCATION_RESULT_SCHEMA_DIGEST` expose the exact shipped schema bytes
for private catalogs and deployment owners to pin.
