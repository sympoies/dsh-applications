# Application manager

`createApplicationManager` exposes exactly `validate`, `resolve`, `lock`,
`start`, `resume`, `status`, `interrupt`, `drain`, `stop`, and `doctor`. It is a
thin public facade over `dsh-runtime-kit`: the same runtime-kit store backs
lifecycle and mediated host actions, and no application method assigns runtime
state or grants authority.

Runtime-kit `reconcile` is deliberately absent from the facade. An
authenticated controller may reach it only through
`createApplicationControlService`, which delegates authentication,
namespace/nonce enforcement, evidence resolution, request/result framing, and
the reconciliation matrix to runtime-kit.

Plugin invocation fails closed unless the isolated rc2 adapter proves an
enforced DSH confinement boundary. The only host callback accepts a complete
`MediatedHostActionRequest`; runtime-kit validates its current assertion and
executes it through the shared mediated-host service. Admission is fenced by
the runtime-kit lifecycle receipt head, the callback is revoked when its DSH
invocation settles, and each request is bounded and detached before any
asynchronous authorization or effect.
