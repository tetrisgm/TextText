export type AssistantAgentIdentity = {
  name: string;
  provider?: string;
  color: string;
  status?: "connected" | "working";
};
