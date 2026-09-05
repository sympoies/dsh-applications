import {
  createApplicationControlService as createProductionControlService,
  createApplicationManager as createProductionManager,
  createPluginSandbox as createProductionSandbox,
  type PublicManagerOperation,
} from "../../packages/manager/src/index.ts";

// Production manager results intentionally cross the public boundary as
// `unknown`. Tests narrow that boundary to inspectable values while preserving
// the production functions' option types.
export type TestManager = Record<string, (request: any, context?: any) => Promise<any>>
  & Record<PublicManagerOperation | "reconcile", (request: any, context?: any) => Promise<any>>;

export function createApplicationManager(
  options: unknown,
): TestManager {
  return createProductionManager(options as Parameters<typeof createProductionManager>[0]) as TestManager;
}

export function createApplicationControlService(
  options: unknown,
): { handle(frame: any, context: any): Promise<any> } {
  return createProductionControlService(options as Parameters<typeof createProductionControlService>[0]) as { handle(frame: any, context: any): Promise<any> };
}

export function createPluginSandbox(
  options: unknown,
): { invoke(request: any): Promise<any> } {
  return createProductionSandbox(options as Parameters<typeof createProductionSandbox>[0]) as { invoke(request: any): Promise<any> };
}
