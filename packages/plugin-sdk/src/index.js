const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;

function fail(message) {
  throw new TypeError(message);
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  }
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) fail(`${label} must be a stable public identifier`);
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) fail(`${label} must be a sha256 digest`);
}

function freezeClone(value) {
  const clone = structuredClone(value);
  const freeze = candidate => {
    if (candidate !== null && typeof candidate === "object" && !Object.isFrozen(candidate)) {
      Object.values(candidate).forEach(freeze);
      Object.freeze(candidate);
    }
    return candidate;
  };
  return freeze(clone);
}

export function defineTrigger(input) {
  const trigger = record(input, "trigger");
  exactKeys(trigger, ["id", "class", "inputSchemaDigest"], [], "trigger");
  identifier(trigger.id, "trigger.id");
  if (!["manual", "event", "channel", "schedule"].includes(trigger.class)) fail("trigger.class is unsupported");
  digest(trigger.inputSchemaDigest, "trigger.inputSchemaDigest");
  return freezeClone(trigger);
}

export function defineOutput(input) {
  const output = record(input, "output");
  exactKeys(output, ["id", "schemaDigest"], [], "output");
  identifier(output.id, "output.id");
  digest(output.schemaDigest, "output.schemaDigest");
  return freezeClone(output);
}

export function definePlugin(runtimeKit, input) {
  if (typeof runtimeKit?.validatePluginDescriptor !== "function") {
    fail("runtime-kit validatePluginDescriptor owner is required");
  }
  const validated = runtimeKit.validatePluginDescriptor(input);
  if (validated !== input) fail("runtime-kit descriptor validator returned a substituted document");
  return freezeClone(validated);
}
