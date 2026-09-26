#!/usr/bin/env node
// Layer 1 · Extract. Transcripts -> per-session metrics + compact views.
// No model calls, no tokens. Safe to run as often as you like: only files that
// changed since the last run are re-read.
//
//   node extract.mjs            # changed transcripts only (same as --new)
//   node extract.mjs --all      # re-read everything
//   node extract.mjs --file <transcript.jsonl>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTranscript } from './lib/transcript.mjs';
import { summarize, METRICS_VERSION } from './lib/metrics.mjs';
import { compactView } from './lib/view.mjs';
import { projectsDir, store, projectFolderName } from './lib/paths.mjs';
import { readJson, writeJson, writeText, readJsonl, readConfig, ensureDir, logError } from './lib/store.mjs';

export function listTranscripts() {
  const root = projectsDir();
  const skip = projectFolderName(store.work()); // debug-mode classification transcripts
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory() || d.name === skip) continue;
    const dir = path.join(root, d.name);
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
  }
  return out;
}

// Subagents live in <session>/subagents/agent-<id>.jsonl with a .meta.json
// naming the tool call that launched them (verified on 2.1.283). Background
// agents return from the tool call at once, so the real span comes from the
// subagent's own timestamps.
function subagentData(file) {
  const dir = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return { entries: [], spans: {} };
  }
  const entries = [];
  const spans = {};
  for (const f of files) {
    const es = readJsonl(path.join(dir, f));
    entries.push(...es);
    const meta = readJson(path.join(dir, f.replace(/\.jsonl$/, '.meta.json')), null);
    const times = es.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite);
    if (meta?.toolUseId && times.length) spans[meta.toolUseId] = { start: Math.min(...times), end: Math.max(...times) };
  }
  return { entries, spans };
}

export function extractFile(file) {
  const entries = readJsonl(file);
  const sub = subagentData(file);
  const session = parseTranscript(entries, { file, subagentEntries: sub.entries, subagentSpans: sub.spans });
  if (!session.id) session.id = path.basename(file, '.jsonl');
  const metrics = summarize(session);
  const workDir = path.resolve(store.work()).toLowerCase();

  let skipped = null;
  if (session.headless) skipped = 'headless';
  else if (session.cwd && path.resolve(session.cwd).toLowerCase().startsWith(workDir)) skipped = 'vibe-check';
  else if (!metrics.counts.typed) skipped = 'no-typed-prompts';
  metrics.skipped = skipped;

  if (!skipped) {
    writeJson(path.join(store.sessions(), `${session.id}.json`), metrics);
    writeText(path.join(store.views(), `${session.id}.txt`), compactView(session, { project: metrics.project }));
  }
  return { id: session.id, skipped, metrics };
}

function pruneViews(days) {
  const cutoff = Date.now() - days * 86400_000;
  let dir;
  try {
    dir = fs.readdirSync(store.views());
  } catch {
    return;
  }
  for (const f of dir) {
    const p = path.join(store.views(), f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  }
}

export function runExtract({ all = false, file = null } = {}) {
  ensureDir(store.root());
  const state = readJson(store.state(), { files: {} });
  if (state.metricsVersion !== METRICS_VERSION) {
    state.files = {};
    state.metricsVersion = METRICS_VERSION;
  }
  const files = file ? [path.resolve(file)] : listTranscripts();
  const result = { scanned: files.length, processed: 0, sessions: [], skipped: 0, unknownTypes: {} };

  for (const f of files) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    const prev = state.files[f];
    if (!all && !file && prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;
    try {
      const r = extractFile(f);
      state.files[f] = { size: st.size, mtimeMs: st.mtimeMs, id: r.id, skipped: r.skipped };
      result.processed++;
      if (r.skipped) result.skipped++;
      else result.sessions.push(r.id);
      for (const [k, v] of Object.entries(r.metrics.unknownTypes || {})) result.unknownTypes[k] = (result.unknownTypes[k] || 0) + v;
    } catch (err) {
      logError(`extract ${f}`, err);
    }
  }
  state.lastRun = Date.now();
  writeJson(store.state(), state);
  pruneViews(readConfig().viewRetentionDays);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const r = runExtract({ all: args.includes('--all'), file: fi >= 0 ? args[fi + 1] : null });
  console.log(`Extracted ${r.processed - r.skipped} session(s) from ${r.scanned} transcript(s); ${r.skipped} skipped.`);
  if (Object.keys(r.unknownTypes).length) console.log(`Unknown entry types seen: ${Object.keys(r.unknownTypes).join(', ')}`);
}
