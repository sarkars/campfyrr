# Campfyrr for Claude Code

Shared team memory for Claude Code. Every teammate's sessions know what the others are changing, what was decided and what was assumed, before they touch the code. The rest of the company follows the work from a link. Campfyrr never stores your code.

## Install

```
claude plugin marketplace add sarkars/ghostcursor
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
