#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createInterface } from "node:readline";

const candidates = [
  process.env.TEXTTEXT_CODEX_RUNTIME,
  `${process.env.HOME}/.local/bin/codex`,
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
].filter(Boolean);
const probeModel = process.env.TEXTTEXT_CODEX_EVAL_MODEL ?? "gpt-5.4-mini";

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
let dynamicToolCalls = 0;
let unexpectedServerRequest = null;

function withTimeout(promise, label, timeout = 180_000) {
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
  if (message.id && message.method) {
    if (message.method === "item/tool/call") {
      const params = message.params ?? {};
      const argumentsValue = params.arguments ?? {};
      if (
        params.tool !== "texttext_runtime_probe" ||
        argumentsValue.nonce !== "safe" ||
        dynamicToolCalls !== 0
      ) {
        unexpectedServerRequest = `unexpected dynamic tool call: ${params.tool ?? "unknown"}`;
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
          contentItems: [{ type: "inputText", text: "TEXTTEXT DYNAMIC TOOL PROBE OK" }],
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
  if (message.id && !message.method) {
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
  await request("initialize", {
    clientInfo: { name: "texttext-runtime-eval", title: "TextText runtime eval", version: "1" },
    capabilities: { experimentalApi: true },
  });
  notify("initialized");

  const account = await request("account/read");
  if (!account?.account) {
    throw new Error("Codex runtime is signed out; owner interaction is required");
  }

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
  const threadStart = await request("thread/start", {
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    model: probeModel,
    config: { mcp_servers: disabledMCPServers },
    dynamicTools: [
      {
        type: "function",
        name: "texttext_runtime_probe",
        description: "Returns a fixed harmless response for TextText runtime verification.",
        inputSchema: {
          type: "object",
          properties: { nonce: { type: "string" } },
          required: ["nonce"],
          additionalProperties: false,
        },
      },
    ],
  });
  if (threadStart?.sandbox?.type !== "readOnly") {
    throw new Error(`effective sandbox is ${threadStart?.sandbox?.type ?? "unknown"}, not readOnly`);
  }
  const started = await startedNotification;
  const threadID = started?.thread?.id;
  if (!threadID || threadID !== threadStart?.thread?.id) {
    throw new Error("thread/started did not confirm the thread/start response");
  }

  let answer = "";
  const completedNotification = nextNotification("turn/completed");
  await request("turn/start", {
    threadId: threadID,
    input: [
      {
        type: "text",
        text: "Do not inspect files or make changes. Call texttext_runtime_probe exactly once with nonce set to safe. After its successful result, reply with exactly: TEXTTEXT RUNTIME PROBE OK",
      },
    ],
    approvalPolicy: "never",
  });
  const completed = await completedNotification;
  if (completed?.turn?.status !== "completed") {
    throw new Error(
      `turn ended with ${completed?.turn?.status ?? "unknown"}: ${completed?.turn?.error?.message ?? "no reason supplied"}`,
    );
  }
  while (!answer.includes("TEXTTEXT RUNTIME PROBE OK")) {
    const delta = await nextNotification("item/agentMessage/delta");
    answer += delta?.delta ?? "";
  }
  if (answer.trim() !== "TEXTTEXT RUNTIME PROBE OK") {
    throw new Error("turn completed without the exact probe response");
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
    model: probeModel,
    effectiveSandbox: threadStart.sandbox.type,
    threadStartedObserved: true,
    turnStatus: completed.turn.status,
    exactResponse: true,
    inheritedMCPServersDisabled: effectiveMCPServers.length,
    dynamicToolCalls,
  }));
} catch (error) {
  console.error(`native-codex-eval: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
