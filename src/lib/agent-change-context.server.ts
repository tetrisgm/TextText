import { AsyncLocalStorage } from "node:async_hooks";

export type AgentChangeActor = {
  userId: string | null;
  connectionId: string;
  runId: string;
  actorType: "ai" | "external_agent";
};
// Trusted server context, never tool arguments or self-declared display names.
export const agentChangeContext = new AsyncLocalStorage<AgentChangeActor>();
