#!/usr/bin/env node
// Campfyrr work-log hook for Claude Code (opt-in).
//
// Files a short entry in your Campfyrr work log -- what the agent just did
// and which files it touched -- so your team sees it under Team updates
// without anyone writing a standup. It calls the same `log_work` MCP tool an
// agent would, with your own token, and redacts nothing itself: the server
// strips secrets before anything is saved.
//
// Installed by campfyrr-setup.mjs --work-log (the one paste on /connect),
// which adds it to ~/.claude/settings.json as a Stop hook and, with
// `--final`, a SessionEnd hook. By hand:
//
//   {
//     "hooks": {
//       "Stop": [{ "hooks": [{ "type": "command", "command": "node /path/to/campfyrr-log-work.mjs" }] }],
//       "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /path/to/campfyrr-log-work.mjs --final" }] }]
//     }
//   }
//
// It reads the token and app URL from ~/.claude/campfyrr/config.json (which
// setup writes), or from CAMPFYRR_TOKEN and CAMPFYRR_URL, which win.
//
// It posts at most once every 30 minutes per session, and only when files
// were edited since the last post; `--final` skips the wait so the session's
// tail end isn't lost. It never blocks or fails the session: every path
// exits 0.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const THROTTLE_MS = 30 * 60_000;
const TIMEOUT_MS = 8_000;
const MAX_SUMMARY = 1_500;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const final = process.argv.includes("--final");

/** Token and app URL: the environment first, then setup's config file. */
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

/** Files edited and the last thing the assistant said, from transcript line
 *  `from` onward. Unparseable lines are skipped: the transcript format is
 *  Claude Code's, not ours, and a change there must not break the session. */
export function scanTranscript(lines, from) {
  const files = new Set();
  let summary = "";
  for (const line of lines.slice(from)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    const text = [];
    for (const part of entry.message.content) {
      if (part?.type === "tool_use" && EDIT_TOOLS.has(part.name)) {
        const file = part.input?.file_path ?? part.input?.notebook_path;
        if (typeof file === "string" && file) files.add(file);
      } else if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
        text.push(part.text.trim());
      }
    }
    if (text.length) summary = text.join("\n\n");
  }
  return { files: [...files], summary };
}

/** Paths relative to the project; anything outside it is reduced to its
 *  file name so a home directory never lands in a shared log. */
export function relativeFiles(files, cwd) {
  return files.map((f) => {
    const rel = path.relative(cwd, f);
    return !rel || rel.startsWith("..") || path.isAbsolute(rel) ? path.basename(f) : rel.split(path.sep).join("/");
  });
}

export function clip(text, max = MAX_SUMMARY) {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

async function main() {
  const { token, base } = await loadConfig();
  if (!token) return;
  const raw = await readStdin();
  if (!(await firstCopy("log-work", raw))) return;
  const input = JSON.parse(raw || "{}");
  if (input.stop_hook_active || !input.transcript_path || !input.session_id) return;

  const stateDir = path.join(tmpdir(), "campfyrr-log-work");
  const stateFile = path.join(stateDir, `${String(input.session_id).replace(/[^\w-]/g, "_")}.json`);
  let state = { line: 0, lastPostAt: 0 };
  try {
    state = { ...state, ...JSON.parse(await readFile(stateFile, "utf8")) };
  } catch {
    // first run for this session
  }
  if (!final && Date.now() - state.lastPostAt < THROTTLE_MS) return;

  const lines = (await readFile(input.transcript_path, "utf8")).split("\n").filter(Boolean);
  const { files, summary } = scanTranscript(lines, state.line);
  if (files.length === 0) return;

  const cwd = input.cwd || process.cwd();
  const touched = relativeFiles(files, cwd);
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
      params: {
        name: "log_work",
        arguments: {
          summary: clip(summary || `Edited ${touched.length} ${touched.length === 1 ? "file" : "files"}.`),
          filesTouched: touched,
          project: path.basename(cwd),
          // So the end-of-day update goes out at 18:00 here, for people who
          // only ever work through their agent.
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return;

  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify({ line: lines.length, lastPostAt: Date.now() }));
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

if (process.argv[1]?.endsWith("campfyrr-log-work.mjs")) {
  rerunThroughProxy();
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
