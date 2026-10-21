#!/usr/bin/env node
// Campfyrr work hook for Claude Code: keeps the team's work moving without
// anyone waiting (see /docs on progress without waiting).
//
// One script, run on several Claude Code events:
//   PostToolUse (Read, Edit, Write, MultiEdit, NotebookEdit, Bash)
//     - the first time this session reads or edits a file in an area of the
//       code, adds what the team knows about that area to Claude's context:
//       work in progress there, decisions that apply, recent changes, what
//       was tried and dropped, open questions. Edits also tell teammates
//       the area is being changed.
//     - on `git commit` or `gh pr create`, writes the reasons for the change
//       and asks Claude to put the link in the pull request.
//   UserPromptSubmit
//     - names the work's goal from the first request, and adds anything new
//       for this work: answers to its questions, work it waited on that
//       landed, decisions that clash or were settled.
//   PreCompact, Stop (at most every 30 minutes), SessionEnd
//     - leaves a handoff from the session, or marks the work finished, so
//       whoever picks it up next starts with it.
//
// Installed by campfyrr-setup.mjs (the paste on /connect). It reads the
// token and app URL from ~/.claude/campfyrr/config.json, or CAMPFYRR_TOKEN
// and CAMPFYRR_URL, which win. It only ever adds context: it never blocks
// the session, stays quiet when Campfyrr can't be reached, and every path
// exits 0.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const TIMEOUT_MS = 8_000;
const HANDOFF_EVERY_MS = 30 * 60_000;
const STORY_EVERY_MS = 10 * 60_000;
const SESSION_TEXT_MAX = 30_000;
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);

async function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(await readFile(path.join(homedir(), ".claude", "campfyrr", "config.json"), "utf8"));
  } catch {
    // no config file: environment only
  }
  // Installed as a Claude Code plugin, the token and address come from the
  // plugin's settings (CLAUDE_PLUGIN_OPTION_*).
  const token = process.env.CAMPFYRR_TOKEN || process.env.CLAUDE_PLUGIN_OPTION_CAMPFYRR_TOKEN || file.token;
  const base = (process.env.CAMPFYRR_URL || process.env.CLAUDE_PLUGIN_OPTION_CAMPFYRR_URL || file.url || "https://campfyrr.vercel.app").replace(/\/+$/, "");
  return { token, base };
}

/** False when another copy of this hook already took this exact event --
 *  it's installed both in a repo's .claude/settings.json and in ~/.claude,
 *  so Claude Code runs both. Identical input within a few seconds is the
 *  same event; the first copy to claim it handles it. */
export async function firstCopy(name, raw, dir = path.join(tmpdir(), "campfyrr-dedupe"), windowMs = 30_000) {
  if (!raw) return true;
  const file = path.join(dir, `${name}-${createHash("sha1").update(raw).digest("hex")}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, String(Date.now()), { flag: "wx" });
    return true;
  } catch (err) {
    if (err?.code !== "EEXIST") return true;
  }
  try {
    if (Date.now() - (await stat(file)).mtimeMs < windowMs) return false;
    await writeFile(file, String(Date.now()));
  } catch {
    // can't tell: handle it
  }
  return true;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON a tool returned, from a plain JSON response or a one-event SSE
 *  stream. Null when the call failed. */
export function toolJson(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    const data = body
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .pop();
    try {
      message = data ? JSON.parse(data) : null;
    } catch {
      message = null;
    }
  }
  const result = message?.result;
  if (!result || result.isError || !Array.isArray(result.content)) return null;
  const text = result.content.find((c) => c?.type === "text")?.text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callTool(config, name, args) {
  const res = await fetch(`${config.base}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok ? toolJson(await res.text()) : null;
}

/** A path relative to the project, or null when it's outside it. */
export function inProject(file, cwd) {
  if (typeof file !== "string" || !file) return null;
  const rel = path.relative(cwd, path.resolve(cwd, file));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** Whether `file` falls under one of `prefixes` ("" = top-level files). */
export function underAny(prefixes, file) {
  return prefixes.some((p) => (p === "" ? !file.includes("/") : file === p || file.startsWith(`${p}/`)));
}

/** A commit or pull request being made. */
export function isChangeCommand(command) {
  if (typeof command !== "string") return null;
  if (/\bgh\s+pr\s+create\b/.test(command)) return "pr";
  if (/\bgit\s+commit\b/.test(command)) return "commit";
  return null;
}

/** The end of the session as plain text: requests, replies and which files
 *  were touched -- what the handoff is written from. */
export function sessionText(lines, max = SESSION_TEXT_MAX) {
  const out = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (entry?.type === "user") {
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : "";
      if (text.trim()) out.push(`Person: ${text.trim()}`);
    } else if (entry?.type === "assistant" && Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "text" && part.text?.trim()) out.push(`Agent: ${part.text.trim()}`);
        else if (part?.type === "tool_use") {
          const target = part.input?.file_path ?? part.input?.notebook_path ?? (typeof part.input?.command === "string" ? part.input.command.slice(0, 120) : "");
          out.push(`(${part.name}${target ? `: ${target}` : ""})`);
        }
      }
    }
  }
  const text = out.join("\n");
  return text.length > max ? text.slice(text.length - max) : text;
}

function output(event, context) {
  if (!context) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}

async function loadState(sessionId) {
  const dir = path.join(tmpdir(), "campfyrr-work");
  const file = path.join(dir, `${String(sessionId).replace(/[^\w-]/g, "_")}.json`);
  let state = { briefed: [], edited: [], goalSent: false, lastHandoffAt: 0, lastStoryAt: 0 };
  try {
    state = { ...state, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    // first run for this session
  }
  return {
    state,
    save: async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(state));
    },
  };
}

async function main() {
  const config = await loadConfig();
  if (!config.token) return;
  const raw = await readStdin();
  if (!(await firstCopy("work", raw))) return;
  const input = JSON.parse(raw || "{}");
  const event = input.hook_event_name;
  if (!event || !input.session_id) return;
  const cwd = input.cwd || process.cwd();
  const project = path.basename(cwd);
  const sessionId = String(input.session_id);
  const { state, save } = await loadState(sessionId);

  if (event === "PostToolUse") {
    const tool = input.tool_name;
    if (FILE_TOOLS.has(tool)) {
      const file = inProject(input.tool_input?.file_path ?? input.tool_input?.notebook_path, cwd);
      if (!file) return;
      const edited = tool !== "Read";
      // Known area, and nothing new to tell the team: no call at all.
      if (underAny(state.briefed, file) && (!edited || underAny(state.edited, file))) return;
      const result = await callTool(config, "work_context", { project, file, edited, sessionId });
      if (!result?.area) return;
      const paths = result.area.paths ?? [];
      state.briefed = [...new Set([...state.briefed, ...paths])];
      if (edited) state.edited = [...new Set([...state.edited, ...paths])];
      await save();
      output(event, result.brief);
      return;
    }
    if (tool === "Bash") {
      const kind = isChangeCommand(input.tool_input?.command);
      if (!kind) return;
      if (kind === "commit" && Date.now() - state.lastStoryAt < STORY_EVERY_MS) return;
      const result = await callTool(config, "change_story", { project, sessionId });
      state.lastStoryAt = Date.now();
      await save();
      if (result?.url) {
        output(
          event,
          `Campfyrr wrote the reasons for this change for its reviewer: ${result.url}\n` +
            (kind === "pr" ? "Add this link to the pull request description now." : "Put this link in the pull request description when you open one.")
        );
      }
      return;
    }
    return;
  }

  if (event === "UserPromptSubmit") {
    const args = { project, sessionId };
    if (!state.goalSent && typeof input.prompt === "string" && input.prompt.trim()) {
      args.prompt = input.prompt.slice(0, 4000);
      state.goalSent = true;
      await save();
    }
    const result = await callTool(config, "session_inbox", args);
    output(event, result?.news ?? null);
    return;
  }

  if (event === "PreCompact" || event === "SessionEnd" || event === "Stop") {
    if (input.stop_hook_active) return;
    // Compacting drops the area briefs from Claude's context: forget which
    // areas were briefed so the next read or edit in each briefs it again.
    if (event === "PreCompact" && state.briefed.length) {
      state.briefed = [];
      await save();
    }
    if (event === "Stop" && Date.now() - state.lastHandoffAt < HANDOFF_EVERY_MS) return;
    // Nothing changed this session: nothing to hand off.
    if (!state.edited.length) return;
    if (!input.transcript_path) return;
    const lines = (await readFile(input.transcript_path, "utf8")).split("\n").filter(Boolean);
    const text = sessionText(lines.slice(-400));
    if (!text.trim()) return;
    state.lastHandoffAt = Date.now();
    await save();
    await callTool(config, "hand_off", { project, sessionId, sessionText: text });
  }
}

/** Behind a proxy (HTTPS_PROXY -- e.g. Claude Code on the web), Node's fetch
 *  only goes through it when NODE_USE_ENV_PROXY is set (Node 22.21+): run
 *  this again with it set, passing stdin along, and exit as that run does. */
function rerunThroughProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy || process.env.NODE_USE_ENV_PROXY) return false;
  let input;
  try {
    input = process.stdin.isTTY ? undefined : readFileSync(0);
  } catch {
    input = undefined;
  }
  const run = spawnSync(process.execPath, process.argv.slice(1), {
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(run.status ?? 0);
}

// Only run when invoked directly, so the helpers above can be tested.
if (process.argv[1]?.endsWith("campfyrr-work.mjs")) {
  rerunThroughProxy();
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
