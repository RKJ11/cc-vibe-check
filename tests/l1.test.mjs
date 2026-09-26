// Layer 1 unit tests: counts from the fixtures must match hand counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../scripts/lib/transcript.mjs';
import { summarize } from '../scripts/lib/metrics.mjs';
import { compactView } from '../scripts/lib/view.mjs';
import { redact } from '../scripts/lib/redact.mjs';
import { readJsonl } from '../scripts/lib/store.mjs';

const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name) => parseTranscript(readJsonl(path.join(fx, `${name}.jsonl`)), { file: `${name}.jsonl` });

test('eleven-turns: hand counts', () => {
  const m = summarize(load('eleven-turns'));
  assert.equal(m.project, 'cc-vibe-check');
  assert.deepEqual(m.counts, {
    typed: 12,
    scored: 11,
    interrupts: 1,
    rejections: 2,
    denials: 0,
    rewinds: 1,
    apiErrors: 1,
    authErrors: 1,
    retries: 1,
    toolCalls: 12,
    toolErrors: 1,
    churnFiles: 1,
    reverts: 1,
    delegatedTurns: 1,
    subagentRuns: 1,
    subagentErrors: 0,
    subagentMs: 60_000,
    sidechainToolCalls: 0,
    sidechainToolErrors: 1,
    compactions: 1,
    clears: 0,
    rewindCommands: 0,
    permissionModeChanges: 2,
  });
  assert.equal(m.endedAfter, null);
});

test('eleven-turns: per-turn flags land on the right turn', () => {
  const t = summarize(load('eleven-turns')).turns;
  const at = (n) => t[n - 1];
  assert.equal(at(1).churnFiles, 1);
  assert.equal(at(1).workMs, 4 * 60_000, 'turn_duration wins over timestamps');
  assert.ok(at(3).interrupted);
  assert.equal(at(3).reverts, 1);
  assert.ok(at(7).rewind);
  assert.equal(t.filter((x) => x.rewind).length, 1);
  assert.equal(at(8).rejections, 1);
  assert.ok(at(9).delegated);
  assert.deepEqual(at(9).slash, ['compact']);
  assert.equal(at(10).authErrors, 1);
  assert.equal(at(10).endedWith, 'error');
  assert.ok(at(11).retry);
  assert.equal(at(11).toolErrors, 1);
  assert.equal(at(11).rejections, 1);
  assert.equal(at(2).waitMs, 3 * 60_000 - 0, 'wait = prompt time minus last activity');
});

test('eleven-turns: the meta caveat is not a prompt', () => {
  const s = load('eleven-turns');
  assert.ok(!s.turns.some((t) => t.text.startsWith('Caveat')));
});

test('legacy format without promptSource', () => {
  const m = summarize(load('legacy'));
  assert.equal(m.counts.typed, 2);
  assert.equal(m.counts.clears, 1);
  assert.equal(m.counts.interrupts, 1);
  assert.equal(m.counts.toolErrors, 0, 'interrupt during a tool is not a tool error');
  assert.equal(m.endedAfter, 'interrupt');
  assert.deepEqual(m.versions, ['1.0.90']);
});

test('headless classification sessions are flagged', () => {
  const s = load('headless');
  assert.ok(s.headless);
  assert.equal(s.turns.length, 0, 'sdk prompts are never typed prompts');
});

test('compact view: prompts, behavior, and quoted words kept verbatim', () => {
  const s = load('eleven-turns');
  const v = compactView(s, { project: 'cc-vibe-check' });
  assert.match(v, /^# Session fx-eleve · project cc-vibe-check · 12 typed prompts/);
  assert.match(v, /T3 USER: you deleted the tests… great job/);
  assert.match(v, /\[developer interrupted the agent\]/);
  assert.match(v, /\[developer rejected Edit and said: "no comments\. none\. ever\."\]/);
  assert.match(v, /T7 USER: perfect.*after-rewind/);
  assert.match(v, /T11 USER: \(same prompt as T10, resent after the API error\).*retry-after-api-error/);
  assert.match(v, /\[API error \(login\/auth\) ×1\]/);
  assert.match(v, /says "wow!" right now/);
  assert.equal(v.split('\n').filter((l) => /^T\d+ USER:/.test(l)).length, 12);
});

test('compact view trims long replies to head and tail', () => {
  const s = load('eleven-turns');
  s.turns[0].agentText = ['A'.repeat(300) + 'MIDDLE'.repeat(100) + 'Z'.repeat(200)];
  const v = compactView(s, {});
  const line = v.split('\n').find((l) => l.startsWith('   AGENT:'));
  assert.ok(!line.includes('MIDDLE'));
  assert.ok(line.includes('…'));
});

test('redaction', () => {
  const cases = [
    ['key sk-ant-api03-abcdefghijklmnop123', '[api-key]'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123', '[token]'],
    ['mail me at dev.person@example.com', '[email]'],
    ['see http://192.168.1.20:8080/admin', '[private-url]'],
    ['https://wiki.corp/secret-page', '[private-url]'],
    ['password=hunter22222', 'password=[redacted]'],
    ['postgres://admin:s3cret@db.example.com/x', 'postgres://[credentials]@db.example.com/x'],
    ['Authorization: Bearer abcdefghijklmnop.qrs', 'Bearer [redacted]'],
  ];
  for (const [input, expected] of cases) assert.ok(redact(input).includes(expected), `${input} -> ${redact(input)}`);
  assert.equal(redact('keep https://github.com/RKJ11/cc-vibe-check as is'), 'keep https://github.com/RKJ11/cc-vibe-check as is');
});

test('extract end to end writes metrics, views and skips headless', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  const proj = path.join(tmp, 'projects', '-work-demo');
  fs.mkdirSync(proj, { recursive: true });
  for (const f of ['eleven-turns', 'legacy', 'headless']) fs.copyFileSync(path.join(fx, `${f}.jsonl`), path.join(proj, `${f}.jsonl`));
  process.env.VIBECHECK_PROJECTS_DIR = path.join(tmp, 'projects');
  process.env.VIBECHECK_HOME = path.join(tmp, 'store');
  const { runExtract } = await import('../scripts/extract.mjs');

  const r1 = runExtract();
  assert.equal(r1.processed, 3);
  assert.equal(r1.skipped, 1);
  assert.deepEqual(r1.sessions.sort(), ['fx-eleven-turns', 'fx-legacy']);
  assert.ok(fs.existsSync(path.join(tmp, 'store', 'views', 'fx-eleven-turns.txt')));
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'store', 'data', 'sessions', 'fx-eleven-turns.json'), 'utf8'));
  assert.ok(!JSON.stringify(stored).includes('great job'), 'metrics never contain prompt text');

  const r2 = runExtract();
  assert.equal(r2.processed, 0, 'unchanged files are not re-read');
  fs.appendFileSync(path.join(proj, 'legacy.jsonl'), '{"type":"brand-new-type"}\n');
  const r3 = runExtract();
  assert.equal(r3.processed, 1);
  assert.deepEqual(r3.unknownTypes, { 'brand-new-type': 1 });
  fs.rmSync(tmp, { recursive: true, force: true });
});
