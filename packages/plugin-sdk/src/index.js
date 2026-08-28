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

export function defineDigest(input) {
  digest(input, "digest");
  return input;
}

function boundedArray(value, label, validate) {
  if (!Array.isArray(value) || value.length > 1024) fail(`${label} must be a bounded array`);
  value.forEach((item, index) => validate(item, `${label}[${index}]`));
  return value;
}

function sortedIdentifiers(value, label) {
  boundedArray(value, label, identifier);
  if (new Set(value).size !== value.length || value.join("\0") !== [...value].sort().join("\0")) {
    fail(`${label} must be sorted and unique`);
  }
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(`${label} is out of range`);
}

function assertJsonValue(value, label) {
  const ancestors = new Set();
  const visit = (candidate, path) => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) fail(`${label} must be lossless JSON`);
      return;
    }
    if (candidate === null || typeof candidate !== "object") fail(`${label} must be lossless JSON`);
    if (ancestors.has(candidate)) fail(`${label} must be lossless JSON`);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if ((!isArray && prototype !== Object.prototype && prototype !== null)
      || (isArray && prototype !== Array.prototype)
      || Object.getOwnPropertySymbols(candidate).length !== 0) fail(`${label} must be lossless JSON`);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if (isArray) {
      const dataKeys = keys.filter(key => key !== "length");
      if (dataKeys.length !== candidate.length) fail(`${label} must be lossless JSON`);
      for (let index = 0; index < dataKeys.length; index += 1) {
        if (dataKeys[index] !== String(index)) fail(`${label} must be lossless JSON`);
      }
    }
    ancestors.add(candidate);
    for (const key of keys) {
      if (isArray && key === "length") continue;
      const descriptor = descriptors[key];
      if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) {
        fail(`${label} must be lossless JSON`);
      }
      visit(descriptor.value, `${path}.${key}`);
    }
    ancestors.delete(candidate);
  };
  visit(value, label);
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

export function defineConfiguration(input) {
  const configuration = record(input, "configuration");
  exactKeys(configuration, ["schemaDigest", "defaults"], [], "configuration");
  digest(configuration.schemaDigest, "configuration.schemaDigest");
  assertJsonValue(configuration.defaults, "configuration.defaults");
  return freezeClone(configuration);
}

export function defineHealth(input) {
  const health = record(input, "health");
  exactKeys(health, ["probes"], [], "health");
  boundedArray(health.probes, "health.probes", (item, label) => {
    const probe = record(item, label);
    exactKeys(probe, ["id", "requirement"], [], label);
    identifier(probe.id, `${label}.id`);
    if (!["required", "optional"].includes(probe.requirement)) fail(`${label}.requirement is unsupported`);
  });
  if (new Set(health.probes.map(probe => probe.id)).size !== health.probes.length) {
    fail("health.probes ids must be unique");
  }
  return freezeClone(health);
}

export function defineSandbox(input) {
  const sandbox = record(input, "sandbox");
  exactKeys(sandbox, [
    "filesystem", "network", "subprocess", "resources", "credentialHandleClasses",
  ], [], "sandbox");
  for (const field of ["filesystem", "network", "subprocess", "credentialHandleClasses"]) {
    sortedIdentifiers(sandbox[field], `sandbox.${field}`);
  }
  const resources = record(sandbox.resources, "sandbox.resources");
  exactKeys(resources, ["cpuClass", "memoryMb", "outputBytes"], [], "sandbox.resources");
  identifier(resources.cpuClass, "sandbox.resources.cpuClass");
  positiveInteger(resources.memoryMb, "sandbox.resources.memoryMb", 1_048_576);
  positiveInteger(resources.outputBytes, "sandbox.resources.outputBytes", 1_073_741_824);
  return freezeClone(sandbox);
}

export function definePlugin(runtimeKit, input) {
  if (typeof runtimeKit?.validatePluginDescriptor !== "function") {
    fail("runtime-kit validatePluginDescriptor owner is required");
  }
  const validated = runtimeKit.validatePluginDescriptor(input);
  if (validated !== input) fail("runtime-kit descriptor validator returned a substituted document");
  return freezeClone(validated);
}
