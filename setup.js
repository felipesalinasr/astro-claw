import { createInterface } from "node:readline/promises";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Config paths — use ASTRO_CLAW_HOME (set by start.js) or fall back to __dirname
const CONFIG_HOME = process.env.ASTRO_CLAW_HOME || __dirname;
const ENV_PATH = resolve(CONFIG_HOME, ".env");
const MCP_PATH = resolve(CONFIG_HOME, "mcp-servers.json");
const MANIFEST_PATH = resolve(__dirname, "slack-manifest.json"); // always from package

// ─── Terminal Colors ────────────────────────────────────────────────
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const CHECK = green("✓");
const CROSS = red("✗");
const WARN = yellow("!");

function step(num, total, label) {
  console.log(`\n  ${bold(`Step ${num}/${total}:`)} ${label}`);
}

// ─── Step 1: Node Version ───────────────────────────────────────────
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 18) {
    console.log(`  ${CROSS} Node.js ${process.versions.node} — need v18 or higher`);
    console.log(`    Download: https://nodejs.org/`);
    process.exit(1);
  }
  console.log(`  ${CHECK} Node.js v${process.versions.node}`);
}

// ─── Step 2: Claude Code CLI ────────────────────────────────────────
async function checkClaudeCli(rl) {
  let version;
  try {
    version = execSync("claude --version", { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    version = null;
  }

  if (version) {
    console.log(`  ${CHECK} Claude Code CLI ${version}`);
    return;
  }

  console.log(`  ${WARN} Claude Code CLI not found`);
  const answer = await rl.question(`    Install it now? ${dim("[Y/n]")} `);

  if (answer.toLowerCase() === "n") {
    console.log(`\n  Install manually: ${cyan("npm install -g @anthropic-ai/claude-code")}`);
    console.log(`  Then run ${cyan("npx astro-claw")} again.\n`);
    process.exit(0);
  }

  console.log(`    Installing Claude Code CLI...`);
  try {
    execSync("npm install -g @anthropic-ai/claude-code", { stdio: "inherit" });
    const v = execSync("claude --version", { encoding: "utf-8", stdio: "pipe" }).trim();
    console.log(`  ${CHECK} Claude Code CLI ${v}`);
  } catch {
    console.log(`  ${CROSS} Installation failed.`);
    console.log(`    Try: ${cyan("sudo npm install -g @anthropic-ai/claude-code")}`);
    console.log(`    Then run ${cyan("npx astro-claw")} again.\n`);
    process.exit(1);
  }
}

// ─── Step 3: Claude Authentication ──────────────────────────────────
async function checkClaudeAuth(rl) {
  function isLoggedIn() {
    try {
      const out = execSync("claude auth status", { encoding: "utf-8", stdio: "pipe" });
      const data = JSON.parse(out);
      return data.loggedIn ? data : null;
    } catch {
      return null;
    }
  }

  const auth = isLoggedIn();
  if (auth) {
    const who = auth.email || auth.authMethod || "authenticated";
    console.log(`  ${CHECK} Claude authenticated (${who})`);
    return;
  }

  console.log(`  ${WARN} Not logged in to Claude`);
  console.log(`    A browser window will open for you to log in.`);
  await rl.question(`    Press Enter to continue... `);

  try {
    spawnSync("claude", ["auth", "login"], { stdio: "inherit" });
  } catch {
    // check status next
  }

  if (isLoggedIn()) {
    console.log(`  ${CHECK} Claude authenticated`);
  } else {
    console.log(`  ${CROSS} Authentication failed.`);
    console.log(`    Run ${cyan("claude auth login")} manually, then ${cyan("npx astro-claw")} again.\n`);
    process.exit(1);
  }
}

// ─── Step 4: Slack App Setup ────────────────────────────────────────
// Returns { botToken, appToken, signingSecret } — some may be null
async function setupSlackApp(rl) {
  // Try self-driving Chrome first
  let autoTokens = null;
  try {
    const { findChrome } = await import("./slack-setup.js");
    if (findChrome()) {
      console.log(`\n    Chrome detected — launching self-driving setup...`);
      const { default: selfDrivingSlackSetup } = await import("./slack-setup.js");
      autoTokens = await selfDrivingSlackSetup();
    }
  } catch (err) {
    console.log(`    ${WARN} Auto-setup unavailable: ${err.message}`);
  }

  // If auto-setup got all tokens, we're done
  if (autoTokens?.botToken && autoTokens?.appToken && autoTokens?.signingSecret) {
    return autoTokens;
  }

  // Fall back to manual flow for any missing tokens
  if (!autoTokens) {
    // Full manual flow — open browser with manifest
    let manifest;
    try { manifest = readFileSync(MANIFEST_PATH, "utf-8"); } catch { manifest = null; }

    if (manifest) {
      const slackUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`;
      console.log(`\n    Opening your browser with the app manifest pre-filled...\n`);
      try {
        const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        execSync(`${openCmd} "${slackUrl}"`, { stdio: "ignore" });
        console.log(`    ${CHECK} Browser opened`);
      } catch {
        console.log(`    ${WARN} Couldn't open browser. Go to: ${cyan(slackUrl)}`);
      }
    } else {
      console.log(`\n    Go to: ${cyan("https://api.slack.com/apps?new_app=1")}`);
      console.log(`    Choose "From a manifest" → paste the JSON from slack-manifest.json`);
    }

    console.log(`\n    ${bold("1.")} Select your workspace → click ${bold("Next")} → ${bold("Create")}`);
    console.log(`    ${bold("2.")} Go to ${bold("Basic Information")} → ${bold("App-Level Tokens")} → ${bold("Generate Token")}`);
    console.log(`         Name it anything → add scope ${bold("connections:write")} → ${bold("Generate")}`);
    console.log(`    ${bold("3.")} Go to ${bold("OAuth & Permissions")} → ${bold("Install to Workspace")} → ${bold("Allow")}`);
    console.log(`    ${bold("4.")} ${dim("(Optional)")} Set the bot icon: ${bold("Basic Information")} → ${bold("Display Information")}`);
    console.log(`         Upload the ${cyan("astronaut-icon.png")} file from this package\n`);
    await rl.question(`    Press Enter when done... `);
  } else {
    // Partial auto — tell user which ones were captured
    const missing = [];
    if (!autoTokens.botToken) missing.push("Bot Token");
    if (!autoTokens.appToken) missing.push("App-Level Token");
    if (!autoTokens.signingSecret) missing.push("Signing Secret");
    console.log(`    ${WARN} Still need: ${bold(missing.join(", "))}`);
    console.log(`    Grab them from your Slack app dashboard.\n`);
  }

  // Collect any missing tokens manually
  return await collectMissingTokens(rl, autoTokens || {});
}

// ─── Step 5: Collect Missing Tokens ─────────────────────────────────
async function collectMissingTokens(rl, existing) {
  async function askToken(label, hint, validator, errorMsg) {
    while (true) {
      const value = (await rl.question(`    ${label} ${dim(hint)} `)).trim();
      if (!value) { console.log(`    ${CROSS} Required.`); continue; }
      if (validator(value)) return value;
      console.log(`    ${CROSS} ${errorMsg}`);
    }
  }

  const needAny = !existing.botToken || !existing.appToken || !existing.signingSecret;
  if (needAny) {
    console.log(`\n    Paste your tokens from the Slack app dashboard:\n`);
  }

  const botToken = existing.botToken || await askToken("Bot Token:", "(OAuth & Permissions > Bot User OAuth Token)", (v) => v.startsWith("xoxb-"), "Must start with xoxb-");
  const appToken = existing.appToken || await askToken("App-Level Token:", "(Basic Information > App-Level Tokens)", (v) => v.startsWith("xapp-"), "Must start with xapp-");
  const signingSecret = existing.signingSecret || await askToken("Signing Secret:", "(Basic Information > Signing Secret)", (v) => /^[0-9a-f]{20,}$/i.test(v), "Must be a hex string (20+ chars)");

  return { botToken, appToken, signingSecret };
}

// ─── Step 6: Validate Tokens ────────────────────────────────────────
async function validateTokens(tokens) {
  console.log(`\n    Validating...`);
  try {
    const { WebClient } = await import("@slack/web-api");
    const client = new WebClient(tokens.botToken);
    const result = await client.auth.test();
    console.log(`  ${CHECK} Connected to workspace ${bold(`"${result.team}"`)} as ${bold(result.user)}`);
    return true;
  } catch (err) {
    console.log(`  ${CROSS} Bot token validation failed: ${err?.data?.error || err.message || "unknown"}`);
    return false;
  }
}

// ─── Step 7: Optional Config ────────────────────────────────────────
async function collectOptionalConfig(rl) {
  console.log(`\n    Optional configuration:\n`);
  console.log(`    ${dim("Find your Slack user ID: click your profile > ⋯ > Copy member ID")}`);
  const adminIds = (await rl.question(`    Admin User ID(s) ${dim("(comma-separated, blank to skip)")} `)).trim();

  if (adminIds) {
    const valid = adminIds.split(",").map((s) => s.trim()).every((id) => /^[UWB][A-Z0-9]{6,15}$/.test(id));
    if (!valid) console.log(`    ${WARN} Some IDs look invalid, saving anyway.`);
  }

  return { adminIds };
}

// ─── Step 8: Write .env ─────────────────────────────────────────────
function writeEnvFile(tokens, optional) {
  const content = `# Astro Claw — generated by setup wizard
# Config home: ${CONFIG_HOME}
# Re-run setup: npx astro-claw --setup

# Slack tokens
SLACK_BOT_TOKEN=${tokens.botToken}
SLACK_APP_TOKEN=${tokens.appToken}
SLACK_SIGNING_SECRET=${tokens.signingSecret}

# No API key needed — uses your Claude CLI login.
# Verify: claude auth status

# Admin user IDs (comma-separated, blank = all users)
ADMIN_USER_IDS=${optional.adminIds || ""}
`;
  writeFileSync(ENV_PATH, content);
  console.log(`  ${CHECK} Configuration saved to ${ENV_PATH}`);
}

// ─── Step 9: MCP Servers ────────────────────────────────────────────
function setupMcpServers() {
  if (!existsSync(MCP_PATH)) {
    writeFileSync(MCP_PATH, "{}\n");
    console.log(`  ${CHECK} MCP servers config created ${dim("(add servers later with !mcp in Slack)")}`);
  } else {
    console.log(`  ${CHECK} MCP servers config exists`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────
export default async function runSetup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log(bold("  🚀 Astro Claw Setup"));
  console.log(dim("  ─────────────────────────────────────────"));
  console.log("");

  try {
    step(1, 4, "Checking Node.js");
    checkNodeVersion();

    step(2, 4, "Claude Code CLI");
    await checkClaudeCli(rl);

    step(3, 4, "Claude authentication");
    await checkClaudeAuth(rl);

    step(4, 4, "Slack app setup");
    let tokens = await setupSlackApp(rl);

    // Validate tokens
    let validated = await validateTokens(tokens);
    while (!validated) {
      const retry = await rl.question(`\n    Re-enter tokens? ${dim("[Y/n]")} `);
      if (retry.toLowerCase() === "n") { rl.close(); return false; }
      tokens = await collectMissingTokens(rl, {});
      validated = await validateTokens(tokens);
    }

    // Optional config + save
    const optional = await collectOptionalConfig(rl);
    writeEnvFile(tokens, optional);
    setupMcpServers();

    rl.close();

    console.log("");
    console.log(bold(green("  ✓ Setup complete!")));
    console.log(dim("  ─────────────────────────────────────────"));
    console.log(`  Config saved to: ${cyan(CONFIG_HOME)}`);
    console.log(`  Starting Astro Claw...\n`);

    return true;
  } catch (err) {
    rl.close();
    if (err.code === "ERR_USE_AFTER_CLOSE" || err.message?.includes("readline was closed")) {
      console.log(`\n\n  Setup cancelled. Run ${cyan("npx astro-claw")} when ready.\n`);
    } else {
      console.error(`\n  Setup error: ${err.message}\n`);
    }
    return false;
  }
}
