// Ambient fallbacks for the optional DeepSeek Harness peer packages that
// `@sympoies/dsh-rc2-adapter` binds its public types to.
//
// TypeScript consults ambient `declare module` declarations before it resolves
// a package from node_modules, so any program that includes this file sees
// these minimal shapes instead of the real DSH declarations, even when the
// peers are installed. Include it only in a program that does not have the
// DSH peers: this repository's `npm run typecheck` does (the optional peers
// are never installed here), and a downstream consumer without the peers can
// add this file to its own program the same way. `npm run test:exact-dsh`
// compiles a separate program that lists only the exact consumer and maps the
// `@deepseek-ai/*` names to the pinned DSH checkout, so it never includes
// this file and remains the authority on the DSH-facing type surface.
declare module "@deepseek-ai/cordis" {
  export interface Context {
    readonly agents: unknown;
    readonly sessions: unknown;
    readonly sessionPersistence: unknown;
  }
}
declare module "@deepseek-ai/dsh-agent" {}
declare module "@deepseek-ai/dsh-session" {}
declare module "@deepseek-ai/dsh-session-persistence" {}
declare module "@deepseek-ai/dsh-tools" {}
