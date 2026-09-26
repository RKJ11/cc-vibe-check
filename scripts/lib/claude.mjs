// The only place that starts a headless Claude Code process. Every guard from
// HLD section 7 is applied here, so classification and the self-test can't
// drift apart.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userClaudeMd } from './paths.mjs';
import { writeJson } from './store.mjs';

// Pinned, never the "haiku" alias: labels must not shift when the alias moves.
export const MODEL = process.env.VIBECHECK_MODEL || 'claude-haiku-4-5-20251001';
const timeoutDefault = () => Number(process.env.VIBECHECK_TIMEOUT_MS) || 180_000;

// Resolve how to launch Claude Code. Returns { cmd, pre } where pre are args
// placed before ours (used when we have to run a JS entry point through node).
export function resolveClaude() {
  const override = process.env.VIBECHECK_CLAUDE_BIN;
  if (override) {
    return /\.(m?js|cjs)$/i.test(override) ? { cmd: process.execPath, pre: [override] } : { cmd: override, pre: [] };
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const win = process.platform === 'win32';
  const names = win ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const name of names) {
    for (const dir of dirs) {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) continue;
      if (!p.toLowerCase().endsWith('.cmd')) return { cmd: p, pre: [] };
      // npm shim: spawning .cmd needs a shell, which would mangle our JSON
      // arguments. Run the JS entry point it points at with node instead.
      const shim = fs.readFileSync(p, 'utf8');
      const m = /"%(?:~?dp0%?)\\?([^"%]+\.(?:m?js|cjs))"/i.exec(shim) || /%dp0%\\([^\s"]+\.(?:m?js|cjs))/i.exec(shim);
      if (m) {
        const js = path.join(dir, m[1]);
        if (fs.existsSync(js)) return { cmd: process.execPath, pre: [js] };
      }
    }
  }
  return { cmd: 'claude', pre: [] };
}

export function claudeVersion() {
  const { cmd, pre } = resolveClaude();
  const r = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true, env: childEnv() });
  const m = /(\d+\.\d+\.\d+)/.exec(r.stdout || '');
  return m ? m[1] : null;
}

function childEnv() {
  return { ...process.env, VIBECHECK_CHILD: '1', MAX_THINKING_TOKENS: '0' };
}

// Every CLAUDE.md that Claude Code would load for `cwd`, by exact path:
// the user file, and CLAUDE.md / CLAUDE.local.md / .claude/CLAUDE.md in cwd
// and every parent up to the root. The org-managed file is intentionally not
// listed.
export function claudeMdExcludes(cwd) {
  const out = [userClaudeMd()];
  let dir = path.resolve(cwd);
  for (;;) {
    out.push(path.join(dir, 'CLAUDE.md'), path.join(dir, 'CLAUDE.local.md'), path.join(dir, '.claude', 'CLAUDE.md'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // exact matching: give both slash styles on Windows
  return process.platform === 'win32' ? [...new Set(out.flatMap((p) => [p, p.replace(/\\/g, '/')]))] : out;
}

export function writeSettings(file, cwd) {
  writeJson(file, { disableAllHooks: true, claudeMdExcludes: claudeMdExcludes(cwd) });
  return file;
}

// Run one headless call. Input goes on stdin; JSON comes back on stdout.
export function runClaude({ cwd, settingsFile, systemPromptFile, schema, input, persist = false, timeoutMs = timeoutDefault(), extraArgs = [] }) {
  const { cmd, pre } = resolveClaude();
  const args = [
    ...pre,
    '-p',
    '--model', MODEL,
    '--tools', '',
    '--settings', settingsFile,
    '--system-prompt-file', systemPromptFile,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
  ];
  if (!persist) args.push('--no-session-persistence');
  args.push(...extraArgs);

  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: `could not start Claude Code: ${err.message}`, durationMs: 0 });
      return;
    }
    try {
      os.setPriority(child.pid, 10);
    } catch {
      // not permitted everywhere; low priority is best effort
    }
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errOut += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `could not start Claude Code: ${err.message}`, durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      let json = null;
      try {
        json = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || 'null');
      } catch {
        // fall through
      }
      if (!json) {
        resolve({ ok: false, error: `no JSON from Claude Code (exit ${code}): ${(errOut || out).trim().slice(0, 300)}`, durationMs });
        return;
      }
      const usage = json.usage || {};
      resolve({
        ok: !json.is_error && code === 0,
        error: json.is_error ? String(json.result || json.subtype || 'error').slice(0, 300) : code ? `exit ${code}` : null,
        structured: json.structured_output ?? parseLooseJson(json.result),
        durationMs,
        inputTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
        outputTokens: usage.output_tokens ?? null,
        costUsd: json.total_cost_usd ?? null,
        raw: json,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function parseLooseJson(text) {
  if (typeof text !== 'string') return null;
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
