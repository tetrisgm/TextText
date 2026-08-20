#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline";
import {
  completedFinalAgentMessage,
  decodeDynamicToolArguments,
  hasJSONRPCID,
} from "./eval-native-codex-protocol.mjs";

const candidates = [
  process.env.TEXTTEXT_CODEX_RUNTIME,
  `${process.env.HOME}/.local/bin/codex`,
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
].filter(Boolean);
const requestedModel = process.env.TEXTTEXT_CODEX_EVAL_MODEL?.trim() || null;
const timeoutMS = Number(process.env.TEXTTEXT_CODEX_EVAL_TIMEOUT_MS ?? 180_000);

let runtime = null;
for (const candidate of candidates) {
  try {
    await access(candidate, constants.X_OK);
    runtime = candidate;
    break;
  } catch {
    // Try the next known location.
  }
}

if (!runtime) {
  console.error("native-codex-eval: no executable Codex runtime found");
  process.exit(2);
}

const child = spawn(runtime, ["app-server", "--stdio"], {
  cwd: process.cwd(),
  env: {
    HOME: process.env.HOME,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
    TMPDIR: process.env.TMPDIR,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let requestID = 0;
const pending = new Map();
const notifications = new Map();
const observedMethods = new Map();
const finalAgentMessages = [];
let dynamicToolCalls = 0;
let unexpectedServerRequest = null;
let stage = "starting";

function withTimeout(promise, label, timeout = timeoutMS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function request(method, params = {}) {
  const id = `eval-${++requestID}`;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return withTimeout(response, method);
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function nextNotification(method) {
  const queued = notifications.get(method);
  if (queued?.values.length) return Promise.resolve(queued.values.shift());
  return withTimeout(
    new Promise((resolve) => {
      const state = notifications.get(method) ?? { values: [], waiters: [] };
      state.waiters.push(resolve);
      notifications.set(method, state);
    }),
    method,
  );
}

function publish(method, params) {
  const state = notifications.get(method) ?? { values: [], waiters: [] };
  const waiter = state.waiters.shift();
  if (waiter) waiter(params);
  else state.values.push(params);
  notifications.set(method, state);
}

createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method) {
    observedMethods.set(message.method, (observedMethods.get(message.method) ?? 0) + 1);
  }
  const finalAgentMessage = completedFinalAgentMessage(message);
  if (finalAgentMessage !== null) finalAgentMessages.push(finalAgentMessage);
  if (hasJSONRPCID(message) && message.method) {
    if (message.method === "item/tool/call") {
      const params = message.params ?? {};
      const argumentsValue = decodeDynamicToolArguments(params.arguments);
      if (
        params.tool !== "list_items" ||
        Object.keys(argumentsValue).some((key) => !["folder_path", "limit"].includes(key)) ||
        dynamicToolCalls !== 0
      ) {
        unexpectedServerRequest =
          `unexpected dynamic tool call` +
          ` (expectedTool=${params.tool === "list_items"}, callIndex=${dynamicToolCalls})`;
        child.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            contentItems: [{ type: "inputText", text: "Probe rejected" }],
            success: false,
          },
        })}\n`);
        return;
      }
      dynamicToolCalls += 1;
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contentItems: [{
            type: "inputText",
            text: JSON.stringify({
              items: [
                { id: "writing", title: "Agentic writing research", excerpt: "A simpler agent workflow for writing." },
                { id: "native", title: "Native AI reliability", excerpt: "Fast in-app tools with bounded failure." },
              ],
            }),
          }],
          success: true,
        },
      })}\n`);
      return;
    }
    unexpectedServerRequest = `unexpected App Server request: ${message.method}`;
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Unsupported during the read-only runtime probe" },
    })}\n`);
    return;
  }
  if (hasJSONRPCID(message) && !message.method) {
    const waiting = pending.get(String(message.id));
    if (!waiting) return;
    pending.delete(String(message.id));
    if (message.error) waiting.reject(new Error(message.error.message ?? "App Server request failed"));
    else waiting.resolve(message.result);
    return;
  }
  if (message.method) publish(message.method, message.params ?? {});
});

createInterface({ input: child.stderr }).on("line", (line) => {
  // Deliberately consume without logging. App Server diagnostics can include
  // provider or MCP details that do not belong in eval output.
  void line;
});

try {
  stage = "initialize";
  await request("initialize", {
    clientInfo: { name: "texttext-runtime-eval", title: "TextText runtime eval", version: "1" },
    capabilities: { experimentalApi: true },
  });
  notify("initialized");

  stage = "account/read";
  const account = await request("account/read");
  if (!account?.account) {
    throw new Error("Codex runtime is signed out; owner interaction is required");
  }

  stage = "config/read";
  const effectiveConfig = await request("config/read");
  const configuredMCPServers = effectiveConfig?.config?.mcp_servers;
  if (!configuredMCPServers || typeof configuredMCPServers !== "object" || Array.isArray(configuredMCPServers)) {
    throw new Error("config/read did not return an MCP server map; refusing an inherited thread");
  }
  const effectiveMCPServers = Object.keys(configuredMCPServers).sort();
  const disabledMCPServers = Object.fromEntries(
    effectiveMCPServers.map((name) => [name, { enabled: false }]),
  );

  const startedNotification = nextNotification("thread/started");
  const threadStartParams = {
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    cwd: process.env.TMPDIR ?? "/tmp",
    developerInstructions:
      "You are the embedded TextText Agent. Use only dynamic tools supplied on this thread for TextText workspace work. Never use installed skills, shell commands, the texttext CLI, a local provider, hosted MCP, or the filesystem. If a dynamic tool fails, report one concise error and stop. Do not retry another integration.",
    config: { mcp_servers: disabledMCPServers },
    dynamicTools: [
      {
        type: "function",
        name: "list_items",
        description: "Lists recent TextText workspace items for an in-app summary.",
        inputSchema: {
          type: "object",
          properties: {
            folder_path: { type: "string" },
            limit: { type: "number" },
          },
          additionalProperties: false,
        },
      },
    ],
  };
  if (requestedModel) threadStartParams.model = requestedModel;
  stage = "thread/start";
  const threadStart = await request("thread/start", threadStartParams);
  if (threadStart?.sandbox?.type !== "readOnly") {
    throw new Error(`effective sandbox is ${threadStart?.sandbox?.type ?? "unknown"}, not readOnly`);
  }
  const started = await startedNotification;
  const threadID = started?.thread?.id;
  if (!threadID || threadID !== threadStart?.thread?.id) {
    throw new Error("thread/started did not confirm the thread/start response");
  }

  const completedNotification = nextNotification("turn/completed");
  stage = "turn/start";
  await request("turn/start", {
    threadId: threadID,
    input: [
      {
        type: "text",
        text: "Summarize what I have been working on recently. Use only the in-app list_items tool and call it exactly once. Do not inspect files or use a skill, CLI, MCP server, or shell. After the tool succeeds, reply with exactly: Recent work centers on agentic writing research and native AI reliability.",
      },
    ],
    approvalPolicy: "never",
  });
  stage = "turn/completed";
  const completed = await completedNotification;
  if (completed?.turn?.status !== "completed") {
    throw new Error(
      `turn ended with ${completed?.turn?.status ?? "unknown"}: ${completed?.turn?.error?.message ?? "no reason supplied"}`,
    );
  }
  stage = "agent response";
  const answer = finalAgentMessages.at(-1) ?? "";
  if (answer.trim() !== "Recent work centers on agentic writing research and native AI reliability.") {
    throw new Error("turn completed without the exact workspace summary");
  }
  if (unexpectedServerRequest) {
    throw new Error(unexpectedServerRequest);
  }
  if (dynamicToolCalls !== 1) {
    throw new Error(`expected one dynamic tool call, observed ${dynamicToolCalls}`);
  }

  console.log(JSON.stringify({
    accountType: account.account.type ?? "unknown",
    planType: account.account.planType ?? "unknown",
    model: threadStart.model ?? requestedModel ?? "account-default",
    effectiveSandbox: threadStart.sandbox.type,
    threadStartedObserved: true,
    turnStatus: completed.turn.status,
    exactResponse: true,
    inheritedMCPServersDisabled: effectiveMCPServers.length,
    dynamicToolCalls,
  }));
} catch (error) {
  const eventSummary = Array.from(observedMethods.entries())
    .map(([method, count]) => `${method}:${count}`)
    .join(",") || "none";
  console.error(
    `native-codex-eval: ${error instanceof Error ? error.message : String(error)}` +
    `; stage=${stage}; events=${eventSummary}; dynamicToolCalls=${dynamicToolCalls}` +
    (unexpectedServerRequest ? `; ${unexpectedServerRequest}` : ""),
  );
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
