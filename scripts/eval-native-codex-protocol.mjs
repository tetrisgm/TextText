export function hasJSONRPCID(message) {
  return message?.id !== undefined && message?.id !== null;
}

export function jsonRPCResult(message, result) {
  if (!hasJSONRPCID(message)) {
    throw new Error("Cannot answer a JSON-RPC request without its id");
  }
  return { jsonrpc: "2.0", id: message.id, result };
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

export function countMatchedTopicGroups(answer, topicGroups) {
  const normalizedAnswer = String(answer ?? "").toLocaleLowerCase();
  return topicGroups.filter((alternatives) =>
    alternatives.some((alternative) =>
      normalizedAnswer.includes(alternative.toLocaleLowerCase()),
    ),
  ).length;
}

const forbiddenNativeItemTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
]);

export function forbiddenNativeEscape(message) {
  if (hasJSONRPCID(message) && message?.method && message.method !== "item/tool/call") {
    return `unexpected App Server request: ${message.method}`;
  }
  const item = message?.params?.item;
  if (item?.type && forbiddenNativeItemTypes.has(item.type)) {
    return `forbidden native item: ${item.type}`;
  }
  return null;
}
