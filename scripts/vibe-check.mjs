#!/usr/bin/env node
// Vibe Check CLI. The /vibe-check skill is a thin launcher for this file, and
// it works the same from any terminal.
//
//   node vibe-check.mjs [--project <name>] [--days <n>] [--no-classify]
//   node vibe-check.mjs --auto on [--yes] | --auto off
//   node vibe-check.mjs selftest | status | classify | --forget [--yes]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runExtract } from './extract.mjs';
import { runRender } from './render.mjs';
import { runClassify, buildQueue, isRunning } from './classify.mjs';
import { selftest } from './lib/selftest.mjs';
import { claudeVersion } from './lib/claude.mjs';
import { store, asset, projectsDir, projectFolderName } from './lib/paths.mjs';
import { readConfig, writeConfig, readJson, logError, parseDays } from './lib/store.mjs';

export const CONSENT_VERSION = 1;

const CONSENT = `Auto-classify: what turning it on means

  • After each Claude Code session ends, a background Haiku call
    (claude-haiku-4-5-20251001) classifies the prompts you typed in that
    session. About 10 seconds; about $0.10 a week at API prices, or a small
    share of a Pro/Max plan.
  • Only a compact, redacted view of the session is sent, to the same model
    provider your Claude Code already uses. Nothing else leaves the machine.
  • Those background calls run with ALL hooks switched off and without
    CLAUDE.md. Your own sessions and hooks are not changed in any way.
  • The calls are not saved as Claude Code sessions. Each one is recorded in
    ~/.claude/vibe-check/runs.jsonl instead.
  • Before it turns on, and whenever Claude Code updates, a self-test checks
    these guards with one tiny call. If a guard fails, auto-classify turns
    itself off.

To agree and turn it on, run:  /vibe-check --auto on --yes
(from a terminal: node vibe-check.mjs --auto on --yes)`;

const HELP = `Usage: /vibe-check [options]

  (no options)          Refresh metrics and the dashboard; classify new prompts in the background
  --project <name>      Only this project (folder name)
  --days <n>            Only the last n days (default 84)
  --no-classify         Refresh measured metrics only, no model calls
  --auto on|off         Classify each session automatically after it ends (asks for consent)
  --forget              Delete everything Vibe Check has stored
  selftest              Re-run the isolation self-test (one tiny model call)
  status                Show classification and auto-classify status`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--project' || k === '--days' || k === '--auto') a[k.slice(2)] = argv[++i];
    else if (k.startsWith('--')) a[k.slice(2)] = true;
    else a._.push(k);
  }
  return a;
}

function spawnDetached(script, args) {
  const child = spawn(process.execPath, [asset.script(script), ...args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
}

const scopeArgs = (a) => [...(a.project ? ['--project', a.project] : []), '--days', String(parseDays(a.days))];

async function report(a) {
  const days = parseDays(a.days);
  const ex = runExtract();
  const { file, data } = runRender({ project: a.project || null, days });
  const lines = [];
  if (a.project && !data.scope.projects.includes(a.project)) {
    lines.push(`No sessions found for project "${a.project}". Known projects: ${data.scope.projects.join(', ') || 'none yet'}.`);
  }
  lines.push(`Vibe Check: ${data.totals.sessions} sessions, ${data.totals.typed} typed prompts in the last ${days} days${ex.processed ? ` (${ex.processed - ex.skipped} updated)` : ''}.`);
  if (Object.keys(ex.unknownTypes).length) lines.push(`Note: new transcript entry types seen (${Object.keys(ex.unknownTypes).join(', ')}); they were skipped.`);

  if (!a['no-classify']) {
    const queue = buildQueue({ project: a.project || null, days });
    if (isRunning()) lines.push('Classification is already running in the background.');
    else if (queue.length) {
      spawnDetached('classify.mjs', scopeArgs(a));
      const turns = queue.reduce((n, q) => n + q.todo.length, 0);
      lines.push(`Classifying ${turns} prompts in ${queue.length} session(s) in the background (about 10 s per session). The dashboard refreshes when it's done.`);
    } else lines.push('All prompts are already classified.');
  }
  lines.push(`Dashboard: ${file}`);
  return lines.join('\n');
}

async function autoCmd(a) {
  const cfg = readConfig();
  if (a.auto === 'off') {
    writeConfig({ ...cfg, auto: false });
    return 'Auto-classify is off. Metrics still refresh after each session at no token cost.';
  }
  if (a.auto !== 'on') return 'Use --auto on or --auto off.';
  if (!a.yes) return CONSENT;
  const st = await selftest();
  const next = { ...cfg, selftest: st };
  if (!st.ok) {
    writeConfig({ ...next, auto: false });
    return `Auto-classify was NOT turned on. ${st.reason}\nManual /vibe-check still works.`;
  }
  writeConfig({ ...next, auto: true, consentVersion: CONSENT_VERSION, consentAt: Date.now() });
  return `Self-test passed on Claude Code ${st.ccVersion} (no hooks fired, no transcript, no CLAUDE.md, ${'thinking off'}).\nAuto-classify is on. Each session is classified shortly after it ends. Turn it off with /vibe-check --auto off.`;
}

async function selftestCmd() {
  const cfg = readConfig();
  const st = await selftest();
  const next = { ...cfg, selftest: st };
  if (!st.ok && cfg.auto) next.auto = false;
  writeConfig(next);
  const lines = Object.entries(st.checks).map(([k, ok]) => `  ${ok ? 'pass' : 'FAIL'}  ${k}`);
  return [`Self-test on Claude Code ${st.ccVersion || '?'}: ${st.ok ? 'passed' : 'FAILED'}`, ...lines, ...(st.reason ? [st.reason] : []), ...(!st.ok && cfg.auto ? ['Auto-classify has been turned off.'] : [])].join('\n');
}

function statusCmd() {
  const cfg = readConfig();
  const st = readJson(store.status(), null);
  const queue = buildQueue({});
  const lines = [
    `Auto-classify: ${cfg.auto ? 'on' : 'off'}`,
    `Self-test: ${cfg.selftest ? `${cfg.selftest.ok ? 'passed' : 'failed'} on Claude Code ${cfg.selftest.ccVersion || '?'}` : 'never run'}`,
    `Classification: ${isRunning() ? `running (${st?.done ?? 0}/${st?.total ?? '?'})` : 'idle'}; ${queue.reduce((n, q) => n + q.todo.length, 0)} prompts pending in ${queue.length} session(s)`,
    `Store: ${store.root()}`,
  ];
  if (st?.lastError) lines.push(`Last error: ${st.lastError}`);
  return lines.join('\n');
}

function forgetCmd(a) {
  const root = store.root();
  if (!a.yes) return `This deletes everything Vibe Check has stored in ${root}: metrics, labels, views, the run log and the dashboard. Your Claude Code transcripts are not touched.\nTo confirm, run: /vibe-check --forget --yes`;
  if (isRunning()) return 'Classification is running. Try again when it has finished.';
  fs.rmSync(root, { recursive: true, force: true });
  return `Deleted ${root}. Vibe Check will start again from your transcripts the next time it runs.`;
}

// Worker started by hook.mjs after a session ends. Runs detached, prints nothing.
async function afterSession(transcript) {
  try {
    const r = runExtract(transcript && fs.existsSync(transcript) ? { file: transcript } : {});
    runExtract(); // plus anything missed earlier
    runRender({});
    pruneDebugTranscripts();
    const cfg = readConfig();
    if (!cfg.auto || cfg.consentVersion !== CONSENT_VERSION) return;
    const v = claudeVersion();
    if (!cfg.selftest?.ok || cfg.selftest.ccVersion !== v) {
      const st = await selftest();
      const next = { ...readConfig(), selftest: st };
      if (!st.ok) next.auto = false;
      writeConfig(next);
      if (!st.ok) {
        runRender({});
        return;
      }
    }
    const id = r.sessions[0];
    if (id) await runClassify({ session: id });
  } catch (err) {
    logError('after-session', err);
  }
}

function pruneDebugTranscripts() {
  const dir = path.join(projectsDir(), projectFolderName(store.work()));
  const cutoff = Date.now() - 7 * 86400_000;
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      if (f.endsWith('.jsonl') && fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  let out;
  if (a.help || cmd === 'help') out = HELP;
  else if (cmd === '_after-session') return afterSession(a._[1]);
  else if (a.forget || cmd === 'forget') out = forgetCmd(a);
  else if (a.auto !== undefined || cmd === 'auto') out = await autoCmd({ ...a, auto: a.auto ?? a._[1] });
  else if (cmd === 'selftest') out = await selftestCmd();
  else if (cmd === 'status') out = statusCmd();
  else if (cmd === 'classify') {
    const r = await runClassify({ project: a.project || null, days: a.days ? parseDays(a.days) : null });
    out = r.locked ? 'Classification is already running.' : `Classified ${r.results?.reduce((n, x) => n + x.labelled, 0) ?? 0} prompt(s) in ${r.total} session(s).`;
  } else if (cmd && cmd !== 'report') out = `Unknown command "${cmd}".\n\n${HELP}`;
  else out = await report(a);
  console.log(out);
}

main().catch((err) => {
  logError('cli', err);
  console.log(`Vibe Check failed: ${err.message}. Details in ${store.log()}`);
  process.exitCode = 1;
});
