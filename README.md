# Astro Claw — Claude Code over Slack

Talk to Claude Code from Slack, using your existing Claude subscription.

## Quick Start

```bash
npx astro-claw
```

The setup wizard walks you through everything on first run.

## Prerequisites

- Node.js 18+
- Claude Code CLI installed and logged in (`claude` command works in your terminal)
- A Claude Pro/Max subscription

## Manual Setup (from source)

```bash
git clone https://github.com/felipesalinasr/astro-claw.git
cd astro-claw
npm install
npm start
```

Edit `.env` with your Slack tokens (already pre-filled if you followed the setup).

## Workspace

The `workspace/` directory is your Claude Code working directory — the equivalent of the folder you'd `cd` into before running `claude` in your terminal.

- `workspace/CLAUDE.md` — system instructions (edit this to customize the agent's behavior)
- `workspace/.claude/skills/` — drop skill files here, same as you would locally

You can also point `WORKSPACE_DIR` in `.env` to any existing project directory that already has a `CLAUDE.md`.

## Run

```bash
npx astro-claw
```

You should see "Astro Claw is online!" — then DM the bot in Slack.

## Slack Commands

- Just message normally — it's like typing in your Claude Code terminal
- `/reset` — start a new session (like closing and reopening terminal)
- `/session` — show current session info

## How Auth Works

No API key needed. The bot uses the same authentication as your `claude` CLI — your subscription login. As long as you're logged into Claude Code on the machine running this bot, it just works.

## License

MIT
