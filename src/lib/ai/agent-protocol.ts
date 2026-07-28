export type WorkspaceAgentToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  requestTag?: string,
) => Promise<unknown>;
