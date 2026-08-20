import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const hostedMcpUrl = "https://texttext.app/api/mcp";
const pluginName = "texttext";
const pluginVersion = "0.1.0";
const canonicalCli = "/Applications/TextText.app/Contents/Helpers/texttext";
const bundledMcpConfigPath = ["plugins", "texttext", ".mcp.json"].join("/");
const skillNames = [
  "texttext",
  "live-document",
  "capture-conversation",
  "project-changelog",
  "publish-collaborate",
];
const commandNames = ["canvas", "changelog"];

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

function runIfAvailable(command, args) {
  const version = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (version.error?.code === "ENOENT") return { skipped: true };
  if (version.status !== 0) {
    fail(`${command} is installed but --version failed: ${version.stderr}`);
  }

  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return { skipped: false };
}

const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const codexManifest = readJson("plugins/texttext/.codex-plugin/plugin.json");
const claudeManifest = readJson("plugins/texttext/.claude-plugin/plugin.json");
const integrationSource = read("src/lib/agent-integrations.ts");
const connectPanelSource = read("src/components/ConnectPanel.tsx");
const pluginReadme = read("plugins/texttext/README.md");
const mainSkill = read("plugins/texttext/skills/texttext/SKILL.md");

for (const [path, contents] of [
  ["plugins/texttext/README.md", pluginReadme],
  ["src/lib/agent-integrations.ts", integrationSource],
]) {
  assert(
    !contents.includes("https://TextText.app"),
    `${path} contains a case-sensitive hosted MCP URL that can break setup`,
  );
}

assert(
  connectPanelSource.includes(
    "--bearer-token-env-var TEXTTEXT_WORKSPACE_TOKEN",
  ) &&
    connectPanelSource.includes(
      "Authorization: Bearer \\${TEXTTEXT_WORKSPACE_TOKEN}",
    ),
  "advanced direct MCP recipes must keep bearer tokens out of saved client configuration",
);
assert(
  !connectPanelSource.includes("codex mcp login texttext"),
  "direct MCP recipes must not invoke OAuth against the token-only TextText server",
);

const codexEntry = codexMarketplace.plugins?.find(
  (entry) => entry.name === pluginName,
);
const claudeEntry = claudeMarketplace.plugins?.find(
  (entry) => entry.name === pluginName,
);

assert(codexMarketplace.name === pluginName, "Codex marketplace name drifted");
assert(codexEntry, "Codex marketplace is missing the TextText plugin");
assert(
  codexEntry.source?.path === "./plugins/texttext",
  "Codex marketplace points at the wrong plugin package",
);
assert(
  codexEntry.policy?.authentication === "ON_USE",
  "Codex plugin must not request authentication during local installation",
);
assert(
  claudeMarketplace.name === pluginName,
  "Claude marketplace name drifted",
);
assert(claudeEntry, "Claude marketplace is missing the TextText plugin");
assert(
  claudeEntry.source === "./plugins/texttext",
  "Claude marketplace points at the wrong plugin package",
);
assert(
  claudeEntry.description === claudeManifest.description,
  "Claude marketplace description must match the installed plugin",
);

for (const [client, manifest] of [
  ["Codex", codexManifest],
  ["Claude", claudeManifest],
]) {
  assert(manifest.name === pluginName, `${client} manifest name drifted`);
}

assert(
  claudeManifest.version === pluginVersion,
  "Claude manifest version drifted",
);
assert(
  new RegExp(`^${pluginVersion.replaceAll(".", "\\.")}\\+codex\\.[0-9]{14}$`).test(
    codexManifest.version,
  ),
  "Codex manifest must carry exactly one timestamped cachebuster",
);

assert(
  codexManifest.skills === "./skills",
  "Codex manifest must discover every skill from its skills directory",
);
assert(
  Array.isArray(claudeManifest.skills) &&
    claudeManifest.skills.length === skillNames.length,
  "Claude manifest must expose every TextText skill",
);

assert(
  !codexManifest.keywords?.includes("mcp"),
  "Codex local plugin must not advertise a bundled MCP integration",
);
assert(
  Array.isArray(codexManifest.interface?.defaultPrompt) &&
    codexManifest.interface.defaultPrompt.some((prompt) =>
      prompt.includes("local TextText command"),
    ),
  "Codex default prompt must lead with the local command",
);

assert(
  !existsSync(join(root, bundledMcpConfigPath)),
  "local plugin must not bundle hosted MCP or start an authenticated server",
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
  assert(
    skill.includes(canonicalCli),
    `${path} does not fall back to the canonical bundled CLI`,
  );
  assert(
    skill.includes('"$TEXTTEXT_CMD" ls'),
    `${path} does not verify the local connection with a harmless read`,
  );
  assert(
    !skill.includes("TEXTTEXT_WORKSPACE_TOKEN") &&
      !skill.includes("same Terminal"),
    `${path} sends a local user through hosted authentication`,
  );
}

for (const commandName of commandNames) {
  const path = `plugins/texttext/commands/${commandName}.md`;
  const command = read(path);
  assert(command.startsWith("---\n"), `${path} is missing YAML frontmatter`);
  assert(command.includes("$ARGUMENTS"), `${path} does not accept arguments`);
  assert(!command.includes("TODO"), `${path} contains unfinished guidance`);
  assert(!command.includes("\u2014"), `${path} contains an em dash`);
  assert(
    command.includes("local `texttext` command"),
    `${path} does not lead with the local CLI`,
  );
}

for (const required of [
  "claude plugin marketplace add tetrisgm/TextText",
  "claude plugin install texttext@texttext",
  "codex plugin marketplace add tetrisgm/TextText",
  "codex plugin add texttext@texttext",
  "command -v texttext",
  canonicalCli,
]) {
  assert(
    integrationSource.includes(required),
    `the product connection catalog is missing ${required}`,
  );
  assert(
    pluginReadme.includes(required),
    `the plugin README is missing ${required}`,
  );
}

for (const forbidden of [
  "TEXTTEXT_TOKEN_PROMPT_COMMAND",
  "TEXTTEXT_WORKSPACE_TOKEN",
  "same Terminal",
  "chatgpt.com/#settings/Connectors",
  'id: "chatgpt"',
]) {
  assert(
    !integrationSource.includes(forbidden),
    `the recommended connection catalog still contains ${forbidden}`,
  );
  assert(
    !pluginReadme.includes(forbidden),
    `the local plugin README still contains ${forbidden}`,
  );
}

for (const required of [
  "command -v texttext",
  canonicalCli,
  '"$TEXTTEXT_CMD" ls',
  "Do not start MCP",
]) {
  assert(mainSkill.includes(required), `the main skill is missing ${required}`);
}

for (const required of [hostedMcpUrl, "Remote and TestFlight clients"]) {
  assert(
    pluginReadme.includes(required),
    `the explicit remote alternative is missing ${required}`,
  );
}

const claudeValidation = runIfAvailable("claude", [
  "plugin",
  "validate",
  "--strict",
  "plugins/texttext",
]);

// Codex does not currently expose a read-only plugin validation command. Do
// not repurpose CODEX_HOME or mutate the owner's configured marketplaces just
// to exercise an installer. The marketplace and plugin manifests are parsed
// and checked above, while the official plugin validator runs in the release
// gate. This verifier remains strictly read-only.
const codexValidation = { skipped: false };

if (process.platform === "darwin" && existsSync(canonicalCli)) {
  const cliHelp = spawnSync(canonicalCli, ["--help"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  assert(
    cliHelp.status === 0,
    "the canonical bundled TextText CLI did not run",
  );
  assert(
    cliHelp.stdout.includes("texttext ls") &&
      cliHelp.stdout.includes("texttext new"),
    "the canonical bundled CLI does not expose the commands taught by the plugin",
  );
}

console.log(
  [
    `Agent integrations verified: token-free local plugins, ${skillNames.length} skills, ${commandNames.length} Claude commands, and explicit hosted MCP.`,
    `Claude parser: ${claudeValidation.skipped ? "not installed" : "passed"}.`,
    `Codex manifest contract: ${codexValidation.skipped ? "not installed" : "passed"}.`,
  ].join(" "),
);
