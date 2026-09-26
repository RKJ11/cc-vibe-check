// Layer 2 (with a fake claude) and Layer 3 tests. Everything runs in a temp
// store; the real ~/.claude is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-l2-'));
const log = path.join(tmp, 'fake.log');
const NOW = Date.parse('2026-09-27T12:00:00Z');

Object.assign(process.env, {
  CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
  VIBECHECK_HOME: path.join(tmp, 'store'),
  VIBECHECK_PROJECTS_DIR: path.join(tmp, 'claude', 'projects'),
  VIBECHECK_CLAUDE_BIN: path.join(here, 'helpers', 'fake-claude.mjs'),
  FAKE_LOG: log,
  FAKE_LABELS: path.join(fx, 'eleven-turns.labels.json'),
});

const { runExtract } = await import('../scripts/extract.mjs');
const { runClassify, buildQueue, validateLabels, acquireLock, releaseLock } = await import('../scripts/classify.mjs');
const { runRender, renderHtml } = await import('../scripts/render.mjs');
const { aggregate, loadAll, vibeScore } = await import('../scripts/lib/aggregate.mjs');
const { selftest } = await import('../scripts/lib/selftest.mjs');
const { claudeMdExcludes } = await import('../scripts/lib/claude.mjs');

before(() => {
  const proj = path.join(tmp, 'claude', 'projects', '-work-cc-vibe-check');
  fs.mkdirSync(proj, { recursive: true });
  for (const f of ['eleven-turns', 'legacy']) fs.copyFileSync(path.join(fx, `${f}.jsonl`), path.join(proj, `${f}.jsonl`));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('validateLabels keeps only requested, well-formed turns', () => {
  const { got, missing } = validateLabels(
    {
      labels: [
        { turn: 1, label: 'new-request', tone: 'neutral', confidence: 0.9, agentReaction: 'defended', ruleCandidate: 'x' },
        { turn: 1, label: 'praise', tone: 'pleased', confidence: 1 },
        { turn: 2, label: 'bogus', tone: 'neutral' },
        { turn: 9, label: 'praise', tone: 'pleased' },
        { turn: 3, label: 'action-correction', tone: 'sarcastic', confidence: 7, ruleCandidate: ' use pnpm ' },
      ],
    },
    [1, 2, 3],
  );
  assert.deepEqual(missing, [2]);
  assert.equal(got.get(1).label, 'new-request');
  assert.equal(got.get(1).agentReaction, null, 'agentReaction only for challenges');
  assert.equal(got.get(1).ruleCandidate, null, 'ruleCandidate only for corrections');
  assert.equal(got.get(3).confidence, 1);
  assert.equal(got.get(3).ruleCandidate, 'use pnpm');
});

test('classify: one isolated call per session, labels cached, retry fills a dropped turn', async () => {
  runExtract();
  const q = buildQueue();
  assert.equal(q.length, 2);
  assert.deepEqual(q.find((x) => x.session.id === 'fx-eleven-turns').todo.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12], 'retry turn T11 is not sent');

  process.env.FAKE_DROP = '1';
  const r = await runClassify({ render: false });
  delete process.env.FAKE_DROP;
  assert.equal(r.total, 2);
  assert.deepEqual(r.results.map((x) => x.missing), [0, 0]);

  const c = calls();
  assert.equal(c.length, 4, 'two sessions, each one call plus one retry');
  for (const call of c) {
    const a = call.args;
    const flag = (k) => a[a.indexOf(k) + 1];
    assert.equal(flag('--model'), 'claude-haiku-4-5-20251001');
    assert.equal(flag('--tools'), '');
    assert.ok(a.includes('--no-session-persistence'));
    assert.ok(a.includes('-p'));
    assert.equal(flag('--output-format'), 'json');
    const settings = JSON.parse(fs.readFileSync(flag('--settings'), 'utf8'));
    assert.equal(settings.disableAllHooks, true);
    assert.ok(settings.claudeMdExcludes.includes(path.join(tmp, 'claude', 'CLAUDE.md')));
    assert.equal(call.env.VIBECHECK_CHILD, '1');
    assert.equal(call.env.MAX_THINKING_TOKENS, '0');
    assert.equal(path.resolve(call.cwd), path.resolve(tmp, 'store', 'work'));
    assert.equal(fs.readdirSync(call.cwd).length, 0, 'runs from an empty folder');
  }
  const retry = c.find((x) => /Label exactly these turns: T12\s*$/.test(x.input));
  assert.ok(retry, 'retry asks only for the missing turn');

  const labels = JSON.parse(fs.readFileSync(path.join(tmp, 'store', 'data', 'labels', 'fx-eleven-turns.json'), 'utf8'));
  assert.equal(Object.keys(labels.labels).length, 11);
  const runs = fs.readFileSync(path.join(tmp, 'store', 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(runs.length, 4);
  assert.equal(runs[0].outputTokens, 900);
  assert.equal(runs[0].ccVersion, '2.1.283');

  const again = await runClassify({ render: false });
  assert.equal(again.total, 0, 'labels are cached; nothing re-sent');
  assert.equal(calls().length, 4);
});

test('lock: a second classifier does not start', () => {
  assert.ok(acquireLock());
  // same pid is alive, so a second acquire fails
  assert.equal(acquireLock(), false);
  releaseLock();
  assert.ok(acquireLock());
  releaseLock();
});

test('aggregate: measured and estimated numbers from the fixtures', () => {
  const d = aggregate(loadAll(), { now: NOW, claudeMd: '' });
  assert.equal(d.totals.sessions, 2);
  assert.equal(d.totals.typed, 14);
  assert.equal(d.estimates.pending, 0);
  assert.equal(d.tiles.gaveUp.sessions, 1);
  assert.deepEqual(
    { total: d.challenges.total, rev: d.challenges['revised-with-reason'], def: d.challenges.defended },
    { total: 2, rev: 1, def: 1 },
  );
  assert.equal(d.rules.length, 1); // the fake applies T2's hand label to the legacy session too
  assert.deepEqual({ text: d.rules[0].text, times: d.rules[0].times, inClaudeMd: d.rules[0].inClaudeMd }, { text: 'do not add explanatory comments to code', times: 3, inClaudeMd: false });
  const withMd = aggregate(loadAll(), { now: NOW, claudeMd: 'never add explanatory comments to code' });
  assert.equal(withMd.rules[0].inClaudeMd, true);
  assert.equal(d.strips[0].id, 'fx-eleve');
  assert.equal(d.strips[0].outTxt, 'Gave up');
  assert.equal(d.strips[1].outTxt, 'Ended on interrupt');
  assert.ok(d.strips[0].events.some((e) => e[1] === 'cor'));
  assert.ok(d.tiles.vibe.value > 0 && d.tiles.vibe.value <= 100);
  assert.equal(d.tiles.vibe.partial, false);
});

test('vibe score: partial when only measured signals exist', () => {
  const s = vibeScore({ interrupts: 5, rejections: 0, rewinds: 0, corrections: null, frustration: null, gaveUp: null });
  assert.deepEqual(s, { value: 72, partial: true, used: ['interrupts', 'rejections', 'rewinds'] });
  assert.equal(vibeScore({ interrupts: 0, rejections: 0, rewinds: 0, corrections: 0, frustration: 0, gaveUp: 0 }).value, 100);
  assert.equal(vibeScore({ interrupts: 99, rejections: 99, rewinds: 99, corrections: 99, frustration: 99, gaveUp: 99 }).value, 0);
});

test('render: self-contained, no external requests, injection-safe', () => {
  const { file } = runRender({ now: NOW });
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(!/<(script|link)[^>]+(src|href)=/i.test(html), 'no external scripts or stylesheets');
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'no URLs besides the SVG namespace');
  assert.equal((html.match(/<\/script>/g) || []).length, 1);

  const evil = aggregate(loadAll(), { now: NOW, claudeMd: '' });
  evil.rules[0].text = '</script><script>alert(1)</script>';
  const out = renderHtml(evil);
  assert.equal((out.match(/<\/script>/g) || []).length, 1, 'data cannot close the script tag');
});

test('render: the dashboard script runs without errors, with and without labels', async () => {
  const { runDashboardScript, countTags } = await import('./helpers/dom-stub.mjs');
  const full = aggregate(loadAll(), { now: NOW, claudeMd: '' });
  const app = runDashboardScript(renderHtml(full));
  assert.equal(countTags(app, 'section'), 8, 'tiles + 7 panels');
  assert.ok(countTags(app, 'svg') >= 2, 'score and friction charts drawn');

  const unlabelled = aggregate({ sessions: loadAll().sessions, labels: {} }, { now: NOW, claudeMd: '' });
  assert.equal(unlabelled.tiles.vibe.partial, true);
  runDashboardScript(renderHtml(unlabelled));

  const empty = aggregate({ sessions: [], labels: {} }, { now: NOW, claudeMd: '' });
  runDashboardScript(renderHtml(empty));
});

test('selftest passes with isolated fake, fails when thinking is on', async () => {
  const ok = await selftest();
  assert.equal(ok.ok, true, ok.reason);
  process.env.FAKE_TOKENS = '5000';
  const bad = await selftest();
  delete process.env.FAKE_TOKENS;
  assert.equal(bad.ok, false);
  assert.equal(bad.checks.thinkingOff, false);
  assert.match(bad.reason, /thinking may be on/);
  assert.ok(!fs.readdirSync(path.join(tmp, 'store')).some((f) => f.startsWith('selftest-')), 'scratch folder removed');
});

test('claudeMdExcludes covers every parent folder', () => {
  const list = claudeMdExcludes(path.join(tmp, 'a', 'b'));
  for (const dir of [path.join(tmp, 'a', 'b'), path.join(tmp, 'a'), tmp]) {
    assert.ok(list.includes(path.join(dir, 'CLAUDE.md')));
    assert.ok(list.includes(path.join(dir, 'CLAUDE.local.md')));
  }
});
