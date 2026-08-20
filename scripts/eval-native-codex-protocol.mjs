export function hasJSONRPCID(message) {
  return message?.id !== undefined && message?.id !== null;
}

export function decodeDynamicToolArguments(value) {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function completedFinalAgentMessage(message) {
  if (message?.method !== "item/completed") return null;
  const item = message.params?.item;
  if (
    item?.type !== "agentMessage" ||
    (item.phase !== undefined && item.phase !== "final_answer") ||
    typeof item.text !== "string"
  ) {
    return null;
  }
  return item.text;
}
