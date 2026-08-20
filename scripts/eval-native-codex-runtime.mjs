#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  countMatchedTopicGroups,
  completedFinalAgentMessage,
  decodeDynamicToolArguments,
  forbiddenNativeEscape,
  hasJSONRPCID,
  jsonRPCResult,
} from "./eval-native-codex-protocol.mjs";
import {
  nativeAssistantTurnPrompt,
  nativeWorkspaceIndex,
} from "../src/lib/ai/native-turn.ts";

const candidates = [
  process.env.TEXTTEXT_CODEX_RUNTIME,
  `${process.env.HOME}/.local/bin/codex`,
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
].filter(Boolean);
const requestedModel = process.env.TEXTTEXT_CODEX_EVAL_MODEL?.trim() || null;
const protocolTimeoutMS = Number(process.env.TEXTTEXT_CODEX_EVAL_TIMEOUT_MS ?? 60_000);
const turnBudgetMS = Number(process.env.TEXTTEXT_CODEX_EVAL_TURN_BUDGET_MS ?? 25_000);

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

// An empty cwd makes a filesystem escape both unnecessary and immediately
// visible in App Server's item stream. HOME remains available only because the
// runtime reads the owner's existing ChatGPT account from its own state.
const isolatedCWD = await mkdtemp(join(tmpdir(), "texttext-native-codex-eval-"));
const child = spawn(runtime, ["app-server", "--stdio"], {
  cwd: isolatedCWD,
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
const numericToolRequestIDs = [];
let dynamicToolCalls = 0;
let unexpectedServerRequest = null;
let stage = "starting";
let scenario = "setup";
let scenarioToolCalls = [];

function withTimeout(promise, label, timeout = protocolTimeoutMS) {
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

function dynamicToolResult(text, success = true) {
  return {
    contentItems: [{ type: "inputText", text }],
    success,
  };
}

function answerServerRequest(message, result) {
  // This is the exact regression boundary. JSON-RPC numeric id 0 must be sent
  // back as number 0, never the superficially similar string "0".
  const response = jsonRPCResult(message, result);
  if (typeof message.id !== "number" || typeof response.id !== "number") {
    unexpectedServerRequest = `dynamic tool request id was not numeric (${typeof message.id})`;
  }
  numericToolRequestIDs.push(response.id);
  child.stdin.write(`${JSON.stringify(response)}\n`);
}

function handleSummaryTool(message, params, argumentsValue) {
  const tool = params.tool ?? params.name;
  unexpectedServerRequest = `workspace-index summary called ${tool} instead of answering directly`;
  scenarioToolCalls.push(tool);
  dynamicToolCalls += 1;
  void argumentsValue;
  answerServerRequest(message, dynamicToolResult("Probe rejected", false));
}

function handleFailureTool(message, params) {
  const tool = params.tool ?? params.name;
  if (scenarioToolCalls.length !== 0 || tool !== "list_folders") {
    unexpectedServerRequest = `failure turn retried or escaped through ${tool}`;
  }
  scenarioToolCalls.push(tool);
  dynamicToolCalls += 1;
  answerServerRequest(
    message,
    dynamicToolResult("The TextText workspace index is temporarily unavailable.", false),
  );
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
  const escape = forbiddenNativeEscape(message);
  if (escape) unexpectedServerRequest = escape;
  const finalAgentMessage = completedFinalAgentMessage(message);
  if (finalAgentMessage !== null) finalAgentMessages.push(finalAgentMessage);
  if (hasJSONRPCID(message) && message.method) {
    if (message.method === "item/tool/call") {
      const params = message.params ?? {};
      const argumentsValue = decodeDynamicToolArguments(params.arguments);
      if (scenario === "summary") handleSummaryTool(message, params, argumentsValue);
      else if (scenario === "failure") handleFailureTool(message, params);
      else {
        unexpectedServerRequest = `tool call arrived during ${scenario}`;
        answerServerRequest(message, dynamicToolResult("Probe rejected", false));
      }
      return;
    }
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

async function startIsolatedThread(disabledMCPServers) {
  const startedNotification = nextNotification("thread/started");
  const threadStartParams = {
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    cwd: isolatedCWD,
    developerInstructions:
      "You are the embedded TextText Agent inside the TextText writing app. Use only the dynamic tools supplied on this thread for TextText workspace work. Never use installed skills, shell commands, the texttext CLI, a local provider, hosted MCP, or the filesystem. If a required TextText dynamic tool is missing or fails, report one concise error and stop. Do not retry through another integration or narrate provider fallback attempts. For read-only requests, do not change workspace content. For a workspace-wide catch-up or recent-work summary, first look for WORKSPACE_INDEX in the user turn. When it is present, answer immediately from that current visible index and make no tool calls. Only when WORKSPACE_INDEX is absent may you call list_folders once, then list_items for the relevant folders. Never call search or read_item for that request, and make at most four dynamic tool calls.",
    config: { mcp_servers: disabledMCPServers },
    dynamicTools: [
      {
        type: "function",
        name: "list_folders",
        description: "Lists the folders in the current TextText workspace.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        type: "function",
        name: "list_items",
        description: "Lists recent TextText items in one workspace folder.",
        inputSchema: {
          type: "object",
          properties: {
            folder_path: { type: "string" },
            limit: { type: "number" },
          },
          required: ["folder_path"],
          additionalProperties: false,
        },
      },
    ],
  };
  if (requestedModel) threadStartParams.model = requestedModel;
  const threadStart = await request("thread/start", threadStartParams);
  if (threadStart?.sandbox?.type !== "readOnly") {
    throw new Error(`effective sandbox is ${threadStart?.sandbox?.type ?? "unknown"}, not readOnly`);
  }
  const started = await startedNotification;
  const threadID = started?.thread?.id;
  if (!threadID || threadID !== threadStart?.thread?.id) {
    throw new Error("thread/started did not confirm the thread/start response");
  }
  return { threadID, threadStart };
}

async function runTurn({
  threadID,
  prompt,
  expectedAnswer,
  expectedMentions = [],
  expectedTopicGroups = [],
  minimumTopicGroups = expectedTopicGroups.length,
  expectedTools,
  label,
  budgetMS = turnBudgetMS,
}) {
  scenario = label;
  scenarioToolCalls = [];
  const finalOffset = finalAgentMessages.length;
  const completedNotification = nextNotification("turn/completed");
  const startedAt = performance.now();
  await request("turn/start", {
    threadId: threadID,
    input: [{ type: "text", text: prompt }],
    approvalPolicy: "never",
  });
  const completed = await withTimeout(completedNotification, `${label} turn`, budgetMS);
  const latencyMS = Math.round(performance.now() - startedAt);
  if (latencyMS > budgetMS) {
    throw new Error(`${label} turn took ${latencyMS}ms, over ${budgetMS}ms`);
  }
  if (completed?.turn?.status !== "completed") {
    throw new Error(
      `${label} turn ended with ${completed?.turn?.status ?? "unknown"}: ${completed?.turn?.error?.message ?? "no reason supplied"}`,
    );
  }
  const answers = finalAgentMessages.slice(finalOffset);
  const answer = answers.at(-1)?.trim() ?? "";
  if (expectedAnswer !== undefined && answer !== expectedAnswer) {
    throw new Error(`${label} turn returned an unexpected final answer`);
  }
  const normalizedAnswer = answer.toLocaleLowerCase();
  const missingMention = expectedMentions.find(
    (mention) => !normalizedAnswer.includes(mention.toLocaleLowerCase()),
  );
  if (missingMention) {
    throw new Error(`${label} turn did not mention ${missingMention}`);
  }
  const matchedTopicGroups = countMatchedTopicGroups(answer, expectedTopicGroups);
  if (matchedTopicGroups < minimumTopicGroups) {
    throw new Error(
      `${label} turn covered ${matchedTopicGroups} grounded topics; expected at least ${minimumTopicGroups}`,
    );
  }
  if (answers.length !== 1) {
    throw new Error(`${label} turn emitted ${answers.length} final answers`);
  }
  if (scenarioToolCalls.join(",") !== expectedTools.join(",")) {
    throw new Error(
      `${label} turn called ${scenarioToolCalls.join(",") || "no tools"}; expected ${expectedTools.join(",")}`,
    );
  }
  if (unexpectedServerRequest) throw new Error(unexpectedServerRequest);
  return latencyMS;
}

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

  const summaryIndex = nativeWorkspaceIndex({
    folders: [
      { id: "blog", name: "Blog" },
      { id: "notes", name: "Notes" },
    ],
    posts: [
      {
        id: "native-ai",
        folderId: "blog",
        type: "article",
        title: "Native AI reliability",
        excerpt: "Making workspace summaries fast, bounded, and dependable.",
        status: "draft",
        updatedAt: "2026-08-20T09:00:00Z",
      },
      {
        id: "agentic-writing",
        folderId: "blog",
        type: "article",
        title: "Agentic writing research",
        excerpt: "Clear writing workflows inspired by strong visual agent tools.",
        status: "draft",
        updatedAt: "2026-08-20T08:00:00Z",
      },
      {
        id: "layout",
        folderId: "notes",
        type: "note",
        title: "Pinned workspace rails",
        excerpt: "Keep navigation and the assistant fixed while documents scroll.",
        status: "draft",
        updatedAt: "2026-08-19T21:00:00Z",
      },
    ],
  });
  if (!summaryIndex) throw new Error("native workspace index was empty");

  stage = "summary thread/start";
  const summaryThread = await startIsolatedThread(disabledMCPServers);
  stage = "summary turn";
  const summaryLatencyMS = await runTurn({
    threadID: summaryThread.threadID,
    label: "summary",
    budgetMS: 10_000,
    expectedTools: [],
    minimumTopicGroups: 2,
    expectedTopicGroups: [
      ["native ai", "native assistant", "reliability", "workspace summaries"],
      ["agentic writing", "writing workflow", "design tools"],
      ["pinned", "fixed", "workspace rails", "navigation", "assistant", "scroll"],
    ],
    prompt: nativeAssistantTurnPrompt({
      context: "The person is at the TextText workspace root.",
      request: "Summarize what I have been working on recently.",
      workspaceIndex: summaryIndex,
    }),
  });

  stage = "failure thread/start";
  const failureThread = await startIsolatedThread(disabledMCPServers);
  stage = "failure turn";
  const failureLatencyMS = await runTurn({
    threadID: failureThread.threadID,
    label: "failure",
    expectedTools: ["list_folders"],
    expectedAnswer: "I could not read your TextText workspace. Try again.",
    prompt:
      "Summarize what I have been working on recently. Call list_folders once. If it fails, do not retry and do not use any other tool or integration. Reply with exactly: I could not read your TextText workspace. Try again.",
  });

  if (numericToolRequestIDs.length !== 1 || numericToolRequestIDs.some((id) => !Number.isInteger(id))) {
    throw new Error("dynamic tool responses did not preserve the numeric JSON-RPC id");
  }

  console.log(JSON.stringify({
    accountType: account.account.type ?? "unknown",
    planType: account.account.planType ?? "unknown",
    model: summaryThread.threadStart.model ?? requestedModel ?? "account-default",
    effectiveSandbox: summaryThread.threadStart.sandbox.type,
    threadStartedObserved: true,
    summaryTurnStatus: "completed",
    summaryLatencyMS,
    summaryDynamicToolCalls: 0,
    failureTurnStatus: "completed",
    failureLatencyMS,
    failureDynamicToolCalls: 1,
    numericToolRequestIDs: numericToolRequestIDs.length,
    inheritedMCPServersDisabled: effectiveMCPServers.length,
    forbiddenEscapesObserved: 0,
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
  await rm(isolatedCWD, { recursive: true, force: true });
}
