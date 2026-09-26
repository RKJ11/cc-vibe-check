#!/usr/bin/env node
// Layer 2 · Classify. Labels every unlabelled typed prompt with one headless
// Haiku call per session. Never runs inside a working session.
//
//   node classify.mjs [--pending] [--project <name>] [--days <n>] [--session <id>]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runExtract } from './extract.mjs';
import { runRender } from './render.mjs';
import { MIN_TYPED_FOR_L2 } from './lib/aggregate.mjs';
import { MODEL, runClaude, writeSettings, claudeVersion } from './lib/claude.mjs';
import { store, asset } from './lib/paths.mjs';
import { appendJsonl, ensureDir, logError, parseDays, readConfig, readJson, writeJson } from './lib/store.mjs';

const CONCURRENCY = 3;
const LOCK_STALE_MS = 30 * 60_000;
const LABELS = new Set(['new-request', 'clarification', 'action-correction', 'claim-challenge', 'give-up', 'praise']);
const TONES = new Set(['neutral', 'curious', 'frustrated', 'sarcastic', 'pleased']);
const REACTIONS = new Set(['defended', 'revised-with-reason', 'flipped-without-reason']);

// ── lock ────────────────────────────────────────────────────────────────
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function acquireLock() {
  ensureDir(store.root());
  const file = store.lock();
  const existing = readJson(file, null);
  if (existing && alive(existing.pid) && Date.now() - existing.at < LOCK_STALE_MS) return false;
  try {
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    return true;
  } catch {
    return false; // another process won the race
  }
}

export function releaseLock() {
  const l = readJson(store.lock(), null);
  if (l?.pid === process.pid) fs.rmSync(store.lock(), { force: true });
}

export const isRunning = () => {
  const l = readJson(store.lock(), null);
  return !!(l && alive(l.pid) && Date.now() - l.at < LOCK_STALE_MS);
};

// ── queue ───────────────────────────────────────────────────────────────
const labelsFile = (id) => path.join(store.labels(), `${id}.json`);

export function loadLabels(id) {
  return readJson(labelsFile(id), null) || { sessionId: id, labels: {} };
}

export function buildQueue({ project = null, days = null, session = null } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(store.sessions()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const from = days ? Date.now() - days * 86400_000 : 0;
  const queue = [];
  for (const f of files) {
    const s = readJson(path.join(store.sessions(), f), null);
    if (!s || s.skipped || s.counts.typed < MIN_TYPED_FOR_L2) continue;
    if (session && !s.id.startsWith(session)) continue;
    if (project && s.project !== project) continue;
    if ((s.lastPrompt ?? 0) < from) continue;
    const view = path.join(store.views(), `${s.id}.txt`);
    if (!fs.existsSync(view)) continue;
    const have = loadLabels(s.id).labels;
    const todo = s.turns.filter((t) => !t.retry && !have[t.uuid]);
    if (todo.length) queue.push({ session: s, view, todo });
  }
  return queue.sort((a, b) => (b.session.lastPrompt ?? 0) - (a.session.lastPrompt ?? 0));
}

// ── output validation ───────────────────────────────────────────────────
export function validateLabels(structured, wanted) {
  const want = new Set(wanted);
  const got = new Map();
  for (const l of structured?.labels || []) {
    const turn = Number(l?.turn);
    if (!want.has(turn) || got.has(turn)) continue;
    if (!LABELS.has(l.label) || !TONES.has(l.tone)) continue;
    const confidence = Number(l.confidence);
    got.set(turn, {
      label: l.label,
      tone: l.tone,
      agentReaction: l.label === 'claim-challenge' && REACTIONS.has(l.agentReaction) ? l.agentReaction : null,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
      ruleCandidate: l.label === 'action-correction' && typeof l.ruleCandidate === 'string' && l.ruleCandidate.trim() ? l.ruleCandidate.trim().slice(0, 140) : null,
    });
  }
  return { got, missing: wanted.filter((t) => !got.has(t)) };
}

function request(viewText, turns) {
  return `${viewText}\n---\nLabel exactly these turns: ${turns.map((n) => `T${n}`).join(', ')}\n`;
}

// ── one session ─────────────────────────────────────────────────────────
async function classifySession(item, ctx) {
  const { session, view, todo } = item;
  const viewText = fs.readFileSync(view, 'utf8');
  const byN = new Map(todo.map((t) => [t.n, t]));
  let wanted = todo.map((t) => t.n);
  const labelled = new Map();
  let lastError = null;

  for (let attempt = 0; attempt < 2 && wanted.length; attempt++) {
    const r = await runClaude({
      cwd: ctx.workDir,
      settingsFile: ctx.settingsFile,
      systemPromptFile: asset.classifierPrompt(),
      schema: ctx.schema,
      input: request(viewText, wanted),
      persist: ctx.debug,
    });
    const { got, missing } = r.structured ? validateLabels(r.structured, wanted) : { got: new Map(), missing: wanted };
    appendJsonl(store.runs(), {
      at: Date.now(),
      kind: attempt ? 'classify-retry' : 'classify',
      session: session.id,
      model: MODEL,
      ccVersion: ctx.ccVersion,
      turnsRequested: wanted.length,
      turnsLabelled: got.size,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      costUsd: r.costUsd ?? null,
      durationMs: r.durationMs,
      view,
      ok: r.ok && !missing.length,
      error: r.error || (missing.length ? `missing turns ${missing.join(',')}` : null),
    });
    for (const [n, l] of got) labelled.set(n, l);
    if (!r.ok && !got.size) lastError = r.error;
    wanted = missing;
  }

  if (labelled.size) {
    const file = loadLabels(session.id);
    const at = Date.now();
    for (const [n, l] of labelled) file.labels[byN.get(n).uuid] = { turn: n, ...l, model: MODEL, at };
    file.updatedAt = at;
    file.model = MODEL;
    writeJson(labelsFile(session.id), file);
  }
  return { id: session.id, labelled: labelled.size, missing: wanted.length, error: lastError };
}

// ── run ─────────────────────────────────────────────────────────────────
export async function runClassify({ project = null, days = null, session = null, render = true, onProgress = null } = {}) {
  if (!acquireLock()) return { locked: true };
  const status = { running: true, total: 0, done: 0, failed: 0, startedAt: Date.now(), finishedAt: null, lastError: null };
  try {
    runExtract(); // catch up on sessions the hook missed
    const queue = buildQueue({ project, days, session });
    status.total = queue.length;
    writeJson(store.status(), status);
    if (!queue.length) return { total: 0, results: [] };

    const cfg = readConfig();
    const workDir = ensureDir(store.work());
    const ctx = {
      workDir,
      debug: !!cfg.debug,
      settingsFile: writeSettings(path.join(store.root(), 'classify-settings.json'), workDir),
      schema: readJson(asset.labelsSchema()),
      ccVersion: claudeVersion(),
    };

    const results = [];
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++];
        let r;
        try {
          r = await classifySession(item, ctx);
        } catch (err) {
          logError(`classify ${item.session.id}`, err);
          r = { id: item.session.id, labelled: 0, missing: item.todo.length, error: String(err.message || err) };
        }
        results.push(r);
        status.done++;
        if (!r.labelled) {
          status.failed++;
          status.lastError = r.error;
        }
        writeJson(store.status(), status);
        onProgress?.(status);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return { total: queue.length, results };
  } finally {
    status.running = false;
    status.finishedAt = Date.now();
    writeJson(store.status(), status);
    releaseLock();
    if (render) {
      try {
        runRender({ project, days: days || 84 });
      } catch (err) {
        logError('render after classify', err);
      }
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const r = await runClassify({ project: val('--project'), days: val('--days') ? parseDays(val('--days')) : null, session: val('--session') });
  if (r.locked) console.log('Classification is already running.');
  else if (!r.total) console.log('Nothing to classify.');
  else {
    const n = r.results.reduce((a, x) => a + x.labelled, 0);
    const miss = r.results.reduce((a, x) => a + x.missing, 0);
    console.log(`Classified ${n} prompt(s) in ${r.total} session(s)${miss ? `; ${miss} still pending` : ''}.`);
    const err = r.results.find((x) => x.error)?.error;
    if (err) console.log(`Last error: ${err}`);
  }
}
