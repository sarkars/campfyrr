---
name: campfyrr
description: How to work in a repository whose team uses Campfyrr, the shared team memory for Claude Code. Use at the start of work, when you finish a change, when something is unclear, and when you stop before the work is done.
when_to_use: Any coding session where Campfyrr's session brief or area briefs appear, or the campfyrr MCP tools are available.
---

# Working with Campfyrr

Your team's sessions share one memory through Campfyrr. It works best when every session reads it and writes to it as it goes. The project is the repository's folder name unless the brief names another.

- **Start with the brief.** The session brief arrives on its own when the session starts. Read it before you begin: it has what changed, open questions, and the rules the team follows.
- **Don't fetch what the brief already holds.** Its rules, decisions, tasks and updates are current; call `gather_rules` or `list_decisions` only for a rule's rationale or what the brief cut.
- **Check memory before you decide or ask.** Call `search_memory` with the question first: the team may have answered it. For a whole topic, `recall` at level 0 gives one line per page; go deeper only where it matters.
- **Follow the area brief.** The first time you read or edit a file in a part of the code, Campfyrr adds what the team knows about it: work in progress there, decisions that apply, what was tried and dropped. Follow those decisions, and build on work in progress rather than around it.
- **Turn unknowns into calls.** When something is unclear, call `state_assumption` with what you're assuming, and keep going. Corrections arrive at a later turn.
- **Say what you're working on.** Call `start_work` when others might touch the same area, and `wait_on` when you depend on unfinished work.
- **Log each finished change.** Call `log_work` with what changed and why, in plain words a non-engineer follows (the outcome first, no file names or jargon), with the files in `filesTouched`. Your end-of-day update is written from these.
- **Record calls.** Use `log_decision` and `log_rule` for decisions and rules, so every later session follows them.
- **Show your work.** When you have a plan, test results or a sample output worth showing teammates, including people who don't read code, call `publish` and share the link it returns.
- **Pass on what the business said.** When the user tells you what a customer, founder or product manager said, or a pricing call or deadline, record it with `add_business_context` against a file in the part it affects, so later sessions there are told.
- **Stop cleanly.** Stopping before the work is done: `hand_off`. Done: `finish_work`.
- **On a pull request,** put the change's reasons link in the description. The hook writes it on commit.

Campfyrr never takes your code or diffs: only file paths, what happened in the session, and what you record.
