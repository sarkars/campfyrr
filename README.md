# Campfyrr for Claude Code

Campfyrr, shared team memory for Claude Code.

[![team memory: Campfyrr](https://campfyrr.vercel.app/badge.svg)](https://campfyrr.vercel.app/?ref=github)

Every teammate's sessions know what the others are changing, what was decided and what was assumed, before they touch the code. The rest of the company follows the work from a link. Campfyrr never stores your code.

## Install

1. Sign in at https://campfyrr.vercel.app/connect?ref=github and create a token.
2. Run `claude plugin marketplace add sarkars/campfyrr`.
3. Run `claude plugin install campfyrr@campfyrr`.
4. Paste the token when the install asks for it.

Or paste the one command on https://campfyrr.vercel.app/connect?ref=github into a terminal. It sets up the same hooks and MCP server without the plugin.

## What it answers

- [What is Campfyrr?](https://campfyrr.vercel.app/?ref=github)
- [Shared memory for Claude Code across a team](https://campfyrr.vercel.app/claude-code-team-memory?ref=github)
- [How to stop multiple AI coding agents from conflicting on the same codebase](https://campfyrr.vercel.app/answers/agents-changing-same-thing?ref=github)
- [Claude Code session handoff between developers](https://campfyrr.vercel.app/answers/continue-another-developers-session?ref=github)
- [Best team memory MCP server for coding agents](https://campfyrr.vercel.app/compare/memory-mcp-servers-vs-team-memory?ref=github)
- [How can product managers follow what Claude Code agents are doing?](https://campfyrr.vercel.app/answers/people-outside-engineering-follow-agent-work?ref=github)

## What it does

- **A brief at session start:** your tasks, teammates' updates, the rules and the decisions that stand.
- **An area brief on the first read or edit in each part of the code:** work in progress there, decisions that apply, what was tried and dropped.
- **News at each request:** answers to your agent's assumptions, work it waited on that landed, decisions that clashed.
- **A handoff when a session stops half-way,** and the reasons for each change, linked from the pull request.

It doesn't run agents, run tests, or replace your tracker or CI. Free during early access; then free for one person, $9 per developer a month for teams, and business teammates free. [See what your agent sees](https://campfyrr.vercel.app/demo?ref=github) · [Pricing](https://campfyrr.vercel.app/pricing?ref=github) · [Trust](https://campfyrr.vercel.app/trust?ref=github) · [How it compares](https://campfyrr.vercel.app/research?ref=github)

---

## The plugin

Shared team memory for Claude Code. Every teammate's sessions know what the others are changing, what was decided and what was assumed, before they touch the code. The rest of the company follows the work from a link. Campfyrr never stores your code.

## Install

```
claude plugin marketplace add sarkars/campfyrr
claude plugin install campfyrr@campfyrr
```

When asked, paste your token from https://campfyrr.vercel.app/connect (sign in, then create a token). Claude Code keeps it in secure storage. To change it later: `/plugin`, then Campfyrr, then Configure options.

## What it adds

- **A session brief** when a session starts: what changed since your last session, open questions, the team's rules.
- **Area briefs** the first time a session reads or edits a part of the code: work in progress there, decisions that apply, what was tried.
- **News during the work:** answers to its questions, work it waited on that landed, decisions that clashed or were settled.
- **Handoffs** when a session stops, and **reasons** for each change on commit.
- **The Campfyrr tools** (`state_assumption`, `log_work`, `log_decision`, `start_work`, `hand_off` and more), and a skill that tells Claude how to use them.

Free for one person. Teams: $9 per developer a month, free during early access.

If you installed Campfyrr earlier with the paste from /connect, you don't need both: remove the Campfyrr hooks from `~/.claude/settings.json`, or skip the plugin.
