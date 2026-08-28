import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  createDshRc2Adapter,
  REQUIRED_AMBIENT_DENIALS,
} from "../packages/dsh-rc2-adapter/src/index.js";

const dshRoot = process.env.DSH_ROOT === undefined ? undefined : resolve(process.env.DSH_ROOT);

async function load(relativePath) {
  const path = join(dshRoot, relativePath);
  await access(path);
  return import(pathToFileURL(path).href);
}

test("the adapter composes and executes through the exact pinned DSH agent tool surface", {
  skip: dshRoot === undefined ? "DSH_ROOT is required" : false,
}, async () => {
  const [
    { Context },
    { default: LlmRuntime },
    { default: SessionStore, SessionId },
    { default: SystemPrompt },
    { default: ToolRuntime },
    { default: AgentRegistry },
    { default: AgentLoop },
    { default: JsonlSessionPersistence },
  ] = await Promise.all([
    load("vendor/cordis/lib/index.js"),
    load("packages/llm/llm/lib/index.js"),
    load("packages/core/session/lib/index.js"),
    load("packages/core/system-prompt/lib/index.js"),
    load("packages/core/tools/lib/index.js"),
    load("packages/core/agent/lib/index.js"),
    load("packages/core/agent-loop/lib/index.js"),
    load("packages/session/session-persistence-jsonl/lib/index.js"),
  ]);
  const persistenceRoot = await mkdtemp(join(tmpdir(), "dsh-applications-exact-"));
  const workspaceRoot = join(persistenceRoot, "workspace");
  await mkdir(workspaceRoot);
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot });

    ctx.tools.register({
      name: "ambient_probe",
      description: "Must be hidden from a plugin-scoped agent.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output: { schema: { type: "null" }, render: () => [] },
      execute: async () => null,
    });

    const identity = Object.freeze({
      deploymentId: "deployment",
      profileId: "profile",
      generationId: "generation",
      instanceId: "instance",
      namespace: "deployment/profile/generation/instance",
    });
    const sessionId = SessionId("sympoies-exact-dsh-consumer");
    const runtime = {
      sessionId,
      root: workspaceRoot,
      agentOptions: { model: "test" },
      memory: {}, queue: {}, credentialHandles: {}, budget: {}, concurrencyController: {},
      configureScope: async () => undefined,
    };
    let bound;
    let evidenceAvailable = false;
    let hostExecutions = 0;
    const hostSandbox = {
      bind(request) {
        bound = Object.freeze(request);
        return bound;
      },
      assertCurrent(binding, request) {
        assert.equal(binding, bound);
        assert.equal(request.agent, bound.agent);
        if (!evidenceAvailable) throw new Error("host confinement intentionally unavailable");
        return {
          owner: "DSH/host",
          enforced: true,
          identity,
          sessionId,
          root: workspaceRoot,
          agentId: bound.agent.id,
          scopeRevision: "exact-dsh-scope-1",
          deniedAmbient: REQUIRED_AMBIENT_DENIALS,
        };
      },
      async execute(binding, invocation, execution) {
        assert.equal(binding, bound);
        assert.equal(execution.agent, bound.agent);
        assert.equal(execution.confinement.owner, "DSH/host");
        hostExecutions += 1;
        return invocation.hostAction({ actionId: invocation.actionId, input: invocation.input });
      },
      release: async () => undefined,
    };
    const adapter = createDshRc2Adapter({ ctx, resolveInstanceRuntime: async () => runtime, hostSandbox });
    assert.deepEqual(await adapter.lifecycleEffects.start({ identity }), {
      status: "succeeded",
      sessionIdentity: sessionId,
    });
    assert.equal(bound.agentCtx.tools.get("ambient_probe", bound.agent), undefined);
    assert.equal(typeof bound.agentCtx.tools.get("sympoies_plugin_action", bound.agent)?.execute, "function");

    // JSONL persistence is intentionally lazy: one owner event materializes
    // the otherwise-empty session so the adapter's cold-resume path is real.
    bound.agent.session.append("todo/write", { todos: [] });

    const invocation = {
      descriptor: { metadata: { id: "review" } },
      actionId: "comment",
      identity,
      input: { pullRequest: 42 },
      hostAction: async request => ({ owner: "runtime-kit-host", request }),
    };
    await assert.rejects(adapter.executePlugin(invocation), /host confinement intentionally unavailable/);
    assert.equal(hostExecutions, 0, "tools.restrict visibility is not accepted as confinement proof");

    evidenceAvailable = true;
    assert.deepEqual(await adapter.executePlugin(invocation), {
      owner: "runtime-kit-host",
      request: { actionId: "comment", input: { pullRequest: 42 } },
    });
    assert.equal(hostExecutions, 1);
    assert.deepEqual(await adapter.lifecycleEffects.interrupt({ identity }), { status: "succeeded" });
    assert.deepEqual(await adapter.lifecycleEffects.drain({ identity }), { status: "succeeded" });
    assert.deepEqual(await adapter.lifecycleEffects.stop({ identity }), {
      status: "succeeded",
      retainedStateDisposition: "retained",
    });

    assert.deepEqual(await adapter.lifecycleEffects.resume({ identity }), {
      status: "succeeded",
      sessionIdentity: sessionId,
    });
    assert.deepEqual(await adapter.executePlugin(invocation), {
      owner: "runtime-kit-host",
      request: { actionId: "comment", input: { pullRequest: 42 } },
    });
    assert.equal(hostExecutions, 2);
    assert.deepEqual(await adapter.lifecycleEffects.drain({ identity }), { status: "succeeded" });
    assert.deepEqual(await adapter.lifecycleEffects.stop({ identity }), {
      status: "succeeded",
      retainedStateDisposition: "retained",
    });
  } finally {
    await ctx.fiber.dispose();
    await rm(persistenceRoot, { recursive: true, force: true });
  }
});
