#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const forceSetup = process.argv.includes("--setup");

// ─── Resolve config home ────────────────────────────────────────────
// Check for local .env first (git clone / dev mode), then ~/.astro-claw/ (npx mode)
const localEnv = resolve(__dirname, ".env");
const globalHome = resolve(homedir(), ".astro-claw");
const globalEnv = resolve(globalHome, ".env");

let CONFIG_HOME;
if (existsSync(localEnv) && !forceSetup) {
  // Local dev mode — config lives alongside the code
  CONFIG_HOME = __dirname;
} else if (existsSync(globalEnv) && !forceSetup) {
  // npx mode — config in home directory
  CONFIG_HOME = globalHome;
} else {
  // First run — use global home for npx, local for git clone
  const isNpx = !existsSync(resolve(__dirname, ".git"));
  CONFIG_HOME = isNpx ? globalHome : __dirname;
}

if (!existsSync(CONFIG_HOME)) {
  mkdirSync(CONFIG_HOME, { recursive: true });
}

// Copy default workspace files if fresh install
const workspaceDir = resolve(CONFIG_HOME, "workspace");
if (!existsSync(workspaceDir)) {
  mkdirSync(workspaceDir, { recursive: true });
  const srcClaude = resolve(__dirname, "workspace", "CLAUDE.md");
  const dstClaude = resolve(workspaceDir, "CLAUDE.md");
  if (existsSync(srcClaude) && !existsSync(dstClaude)) {
    cpSync(srcClaude, dstClaude);
  }
}

// Set environment for setup.js and index.js
process.env.ASTRO_CLAW_HOME = CONFIG_HOME;
process.env.WORKSPACE_DIR = process.env.WORKSPACE_DIR || workspaceDir;

const envPath = resolve(CONFIG_HOME, ".env");

if (forceSetup || !existsSync(envPath)) {
  if (!forceSetup) {
    console.log("\n  Welcome to Astro Claw! Starting setup...\n");
  }
  const { default: runSetup } = await import("./setup.js");
  const success = await runSetup();
  if (!success) process.exit(1);
}

// Load env from the resolved config home
process.env.DOTENV_CONFIG_PATH = envPath;
await import("dotenv/config");

// Start the bot
await import("./index.js");
