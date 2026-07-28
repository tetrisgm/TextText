import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const hostedMcpUrl = "https://texttext.app/api/mcp";
const pluginName = "texttext";
const pluginVersion = "0.1.0";
const skillNames = [
  "texttext",
  "capture-conversation",
  "project-changelog",
  "publish-collaborate",
];

function fail(message) {
  throw new Error(`Agent integration verification failed: ${message}`);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const codexManifest = readJson("plugins/texttext/.codex-plugin/plugin.json");
const claudeManifest = readJson("plugins/texttext/.claude-plugin/plugin.json");
const mcpConfig = readJson("plugins/texttext/.mcp.json");
const integrationSource = read("src/lib/agent-integrations.ts");
const pluginReadme = read("plugins/texttext/README.md");

const codexEntry = codexMarketplace.plugins?.find(
  (entry) => entry.name === pluginName,
);
const claudeEntry = claudeMarketplace.plugins?.find(
  (entry) => entry.name === pluginName,
);

assert(codexMarketplace.name === pluginName, "Codex marketplace name drifted");
assert(codexEntry, "Codex marketplace is missing the Texttext plugin");
assert(
  codexEntry.source?.path === "./plugins/texttext",
  "Codex marketplace points at the wrong plugin package",
);
assert(
  codexEntry.policy?.authentication === "ON_INSTALL",
  "Codex plugin must request authentication during installation",
);
assert(claudeMarketplace.name === pluginName, "Claude marketplace name drifted");
assert(claudeEntry, "Claude marketplace is missing the Texttext plugin");
assert(
  claudeEntry.source === "./plugins/texttext",
  "Claude marketplace points at the wrong plugin package",
);

for (const [client, manifest] of [
  ["Codex", codexManifest],
  ["Claude", claudeManifest],
]) {
  assert(manifest.name === pluginName, `${client} manifest name drifted`);
  assert(
    manifest.version === pluginVersion,
    `${client} manifest version drifted`,
  );
  assert(
    Array.isArray(manifest.skills) &&
      manifest.skills.length === skillNames.length,
    `${client} manifest must expose every Texttext skill`,
  );
}

assert(
  mcpConfig.mcpServers?.texttext?.type === "http",
  "plugin MCP transport must be HTTP",
);
assert(
  mcpConfig.mcpServers?.texttext?.url === hostedMcpUrl,
  "plugin MCP endpoint drifted",
);

for (const skillName of skillNames) {
  const path = `plugins/texttext/skills/${skillName}/SKILL.md`;
  const skill = read(path);
  assert(skill.startsWith("---\n"), `${path} is missing YAML frontmatter`);
  assert(
    skill.includes(`name: ${skillName}`),
    `${path} has the wrong skill name`,
  );
  assert(!skill.includes("TODO"), `${path} contains unfinished guidance`);
  assert(!skill.includes("\u2014"), `${path} contains an em dash`);
}

for (const required of [
  hostedMcpUrl,
  "claude plugin marketplace add tetrisgm/write",
  "claude plugin install texttext@texttext",
  "codex plugin marketplace add tetrisgm/write",
  "codex plugin add texttext@texttext",
  "https://chatgpt.com/#settings/Connectors",
]) {
  assert(
    integrationSource.includes(required),
    `the product connection catalog is missing ${required}`,
  );
}

for (const required of [
  "claude plugin marketplace add tetrisgm/write",
  "claude plugin install texttext@texttext",
  "codex plugin marketplace add tetrisgm/write",
  "codex plugin add texttext@texttext",
  hostedMcpUrl,
]) {
  assert(
    pluginReadme.includes(required),
    `the plugin README is missing ${required}`,
  );
}

console.log(
  `Agent integrations verified: 2 native plugins, ${skillNames.length} skills, hosted OAuth MCP, and ChatGPT setup.`,
);
