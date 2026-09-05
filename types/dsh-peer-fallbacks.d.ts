// Ambient fallbacks for the optional DeepSeek Harness peer packages that
// `@sympoies/dsh-rc2-adapter` binds its public types to.
//
// `npm run typecheck` runs from a checkout that does not install the optional
// DSH peers, so these declarations let the workspace sources type-check on
// their own. They are deliberately minimal: `npm run test:exact-dsh` compiles
// the adapter against the exact pinned DSH checkout's own declarations, which
// take precedence whenever the real packages resolve, and that run is the
// authority on the DSH-facing type surface.
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
