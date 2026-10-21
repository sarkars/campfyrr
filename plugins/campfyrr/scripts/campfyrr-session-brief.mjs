#!/usr/bin/env node
// Campfyrr session brief for Claude Code (a SessionStart hook).
//
// Before the first message of a session, fetches your team's brief -- your
// open tasks, teammates' updates since your last session, the rules and
// best practices in force, and the decisions on record -- and hands it to
// Claude as context, so nobody has to ask for it. It calls the same
// `session_brief` MCP tool an agent would, with your own token, for the
// project named after the folder the session starts in.
//
// Installed by campfyrr-setup.mjs (the one paste on /connect). By hand, in
// ~/.claude/settings.json:
//
//   {
//     "hooks": {
//       "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /path/to/campfyrr-session-brief.mjs", "timeout": 20 }] }]
//     }
//   }
//
// It reads the token and app URL from ~/.claude/campfyrr/config.json, or
// from CAMPFYRR_TOKEN and CAMPFYRR_URL, which win. It never blocks or fails
// the session: with no token, no network, or an error it prints nothing
// and exits 0.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const TIMEOUT_MS = 10_000;
const DUPLICATE_MS = 60_000;

/** True when another copy of this hook (installed both in a repo's
 *  .claude/settings.json and in ~/.claude) already briefed this session
 *  start; otherwise marks it as briefed. One brief is enough context. */
export async function alreadyBriefed(sessionId, source, dir = path.join(tmpdir(), "campfyrr-brief")) {
  if (!sessionId) return false;
  const file = path.join(dir, `${String(sessionId).replace(/[^\w-]/g, "_")}-${String(source || "startup").replace(/[^\w-]/g, "_")}`);
  try {
    if (Date.now() - (await stat(file)).mtimeMs < DUPLICATE_MS) return true;
  } catch {
    // not briefed yet
  }
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, String(Date.now()));
  } catch {
    // can't mark: brief anyway
  }
  return false;
}

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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The text of a tools/call result, from a plain JSON response or a
 *  one-event SSE stream (the server answers with either). Null when the
 *  call failed or the body isn't what we expect. */
export function toolText(body) {
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
  const text = result.content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return text || null;
}

/** What Claude Code reads from a SessionStart hook's stdout. */
export function hookOutput(brief) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: brief } });
}

async function main() {
  const { token, base } = await loadConfig();
  if (!token) return;
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    // no hook input: brief for the current folder
  }
  if (await alreadyBriefed(input.session_id, input.source)) return;
  const cwd = input.cwd || process.cwd();
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "session_brief", arguments: { project: path.basename(cwd) } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return;
  const brief = toolText(await res.text());
  if (brief) process.stdout.write(hookOutput(brief));
}

// Only run when invoked directly, so the helpers above can be tested.
/** Behind a proxy (HTTPS_PROXY -- e.g. Claude Code on the web), Node's fetch
 *  only goes through it when NODE_USE_ENV_PROXY is set (Node 22.21+): run
 *  this again with it set, passing stdin along, and exit as that run does.
 *  False when there's no proxy, or it's already set. */
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

if (process.argv[1]?.endsWith("campfyrr-session-brief.mjs")) {
  rerunThroughProxy();
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
