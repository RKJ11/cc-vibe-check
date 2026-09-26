// Stored metrics + labels -> the numbers the dashboard shows.
// Pure functions: same input, same output. No model involved.
import fs from 'node:fs';
import path from 'node:path';
import { store, userClaudeMd } from './paths.mjs';
import { readJson } from './store.mjs';
import { fmtDuration } from './view.mjs';

export const MIN_TYPED_FOR_L2 = 2;

// Vibe score: each component is a rate, capped, then weighted. A higher rate
// means more friction; a component at its cap costs its full weight.
export const SCORE = [
  { key: 'interrupts', label: 'interrupts', weight: 25, cap: 10, kind: 'measured' }, // per 100 prompts
  { key: 'corrections', label: 'action corrections', weight: 25, cap: 25, kind: 'estimated' }, // per 100 labelled prompts
  { key: 'gaveUp', label: 'gave up', weight: 20, cap: 30, kind: 'estimated' }, // % of labelled sessions
  { key: 'rejections', label: 'tool rejections', weight: 10, cap: 10, kind: 'measured' }, // per 100 prompts
  { key: 'rewinds', label: 'rewinds', weight: 10, cap: 5, kind: 'measured' }, // per 100 prompts
  { key: 'frustration', label: 'frustration', weight: 10, cap: 20, kind: 'estimated' }, // % of labelled prompts
];
const MIN_WEEK_PROMPTS = 5;
const LOW_CONFIDENCE = 0.6;

export function loadAll() {
  const read = (dir) => {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    return files.map((f) => readJson(path.join(dir, f))).filter(Boolean);
  };
  const sessions = read(store.sessions()).filter((s) => !s.skipped && s.counts?.typed);
  const labels = {};
  for (const l of read(store.labels())) labels[l.sessionId] = l;
  return { sessions, labels };
}

export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (ts) => {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const pad = (n) => String(n).padStart(2, '0');
const fmtWhen = (ts) => {
  const d = new Date(ts);
  return `${fmtDay(ts)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function prettyModel(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id || '');
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

const per100 = (n, d) => (d ? (n / d) * 100 : null);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function labelFor(labels, s, t) {
  const l = labels[s.id]?.labels?.[t.uuid];
  return l && !l.invalid ? l : null;
}

const isFriction = (t) => t.interrupted || t.rejections > 0 || t.rewind;

// Aggregate one bucket of turns (a week, the whole period, ...).
function bucket(sessions, labels, turnFilter = () => true) {
  const b = { prompts: 0, interrupts: 0, rejections: 0, rewinds: 0, labelled: 0, corrections: 0, frustrated: 0, sessionsLabelled: 0, gaveUp: 0 };
  for (const s of sessions) {
    let sessionLabelled = false;
    let sessionGaveUp = false;
    for (const t of s.turns) {
      if (t.retry || !turnFilter(t, s)) continue;
      b.prompts++;
      if (t.interrupted) b.interrupts++;
      b.rejections += t.rejections;
      if (t.rewind) b.rewinds++;
      const l = labelFor(labels, s, t);
      if (!l) continue;
      sessionLabelled = true;
      b.labelled++;
      if (l.label === 'action-correction') b.corrections++;
      if (l.label === 'give-up') sessionGaveUp = true;
      if (l.tone === 'frustrated' || l.tone === 'sarcastic') b.frustrated++;
    }
    if (sessionLabelled) b.sessionsLabelled++;
    if (sessionGaveUp) b.gaveUp++;
  }
  return b;
}

export function rates(b) {
  return {
    interrupts: per100(b.interrupts, b.prompts),
    rejections: per100(b.rejections, b.prompts),
    rewinds: per100(b.rewinds, b.prompts),
    corrections: per100(b.corrections, b.labelled),
    frustration: per100(b.frustrated, b.labelled),
    gaveUp: per100(b.gaveUp, b.sessionsLabelled),
  };
}

export function vibeScore(r) {
  let lost = 0;
  let total = 0;
  const used = [];
  for (const c of SCORE) {
    if (r[c.key] == null) continue;
    total += c.weight;
    lost += c.weight * Math.min(1, r[c.key] / c.cap);
    used.push(c.key);
  }
  if (!total) return null;
  return { value: Math.round(100 * (1 - lost / total)), partial: used.length < SCORE.length, used };
}

function claudeMdText(cwds) {
  const files = new Set([userClaudeMd()]);
  for (const cwd of cwds) {
    if (!cwd) continue;
    files.add(path.join(cwd, 'CLAUDE.md'));
    files.add(path.join(cwd, 'CLAUDE.local.md'));
    files.add(path.join(cwd, '.claude', 'CLAUDE.md'));
  }
  let text = '';
  for (const f of files) {
    try {
      text += '\n' + fs.readFileSync(f, 'utf8');
    } catch {
      // missing is fine
    }
  }
  return normRule(text);
}

export const normRule = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'dont', 'don', 'not', 'never', 'always', 'use', 'from', 'into', 'your', 'you', 'any', 'unless', 'asked']);
function ruleInText(rule, text) {
  const words = normRule(rule).split(' ').filter((w) => w.length > 3 && !STOP.has(w));
  if (!words.length || !text) return false;
  const hit = words.filter((w) => text.includes(w)).length;
  return hit / words.length >= 0.75;
}

export function aggregate({ sessions, labels }, { project = null, days = 84, now = Date.now(), runs = [], config = {}, status = null, claudeMd = null } = {}) {
  const from = now - days * 86400_000;
  const inScope = sessions
    .filter((s) => (s.lastPrompt ?? s.end ?? 0) >= from)
    .filter((s) => !project || s.project === project)
    .sort((a, b) => (a.firstPrompt ?? 0) - (b.firstPrompt ?? 0));

  const all = bucket(inScope, labels);
  const allRates = rates(all);

  // ── weeks ──────────────────────────────────────────────────────────────
  const uniqWeeks = [];
  for (let w = weekStart(from); w <= now; w = weekStart(w + 8 * 86400_000)) uniqWeeks.push(w);
  const weeks = uniqWeeks.map((w) => {
    const b = bucket(inScope, labels, (t) => t.ts != null && weekStart(t.ts) === w);
    const r = rates(b);
    const score = b.prompts >= MIN_WEEK_PROMPTS ? vibeScore(r) : null;
    return {
      week: w,
      label: fmtDay(w),
      prompts: b.prompts,
      labelled: b.labelled,
      score: score?.value ?? null,
      partial: score?.partial ?? false,
      interrupts: round1(r.interrupts),
      rejections: round1(r.rejections),
      rewinds: round1(r.rewinds),
      corrections: round1(r.corrections),
    };
  });

  // version / model change marks, by dominant value per week
  const marks = [];
  let prevV = null;
  let prevM = null;
  uniqWeeks.forEach((w, i) => {
    const vc = {};
    const mc = {};
    for (const s of inScope) {
      if (s.firstPrompt == null || weekStart(s.firstPrompt) !== w) continue;
      const v = s.versions?.[s.versions.length - 1];
      if (v) vc[v] = (vc[v] || 0) + s.counts.typed;
      for (const m of s.models || []) mc[m] = (mc[m] || 0) + s.counts.typed;
    }
    const top = (c) => Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const v = top(vc);
    const m = top(mc);
    if (v && prevV && v !== prevV) marks.push({ i, label: `CC ${v}` });
    if (m && prevM && m !== prevM) marks.push({ i, label: prettyModel(m) });
    if (v) prevV = v;
    if (m) prevM = m;
  });

  // ── tiles ──────────────────────────────────────────────────────────────
  const scored = weeks.filter((w) => w.score != null);
  const vibeNow = vibeScore(allRates);
  const lastW = scored[scored.length - 1];
  const cmpW = scored.length > 4 ? scored[scored.length - 5] : scored[0];

  const firstTry = (() => {
    let requests = 0;
    let accepted = 0;
    for (const s of inScope) {
      const ts = s.turns.filter((t) => !t.retry);
      ts.forEach((t, i) => {
        const l = labelFor(labels, s, t);
        if (l?.label !== 'new-request') return;
        const next = ts[i + 1];
        const nl = next ? labelFor(labels, s, next) : null;
        if (next && !nl) return; // can't tell yet
        requests++;
        if (!t.interrupted && !t.rejections && nl?.label !== 'action-correction' && nl?.label !== 'give-up') accepted++;
      });
    }
    return requests ? Math.round((accepted / requests) * 100) : null;
  })();

  const gaveUp = (() => {
    let n = 0;
    let late = 0;
    for (const s of inScope) {
      const t = s.turns.find((x) => labelFor(labels, s, x)?.label === 'give-up');
      if (!t) continue;
      n++;
      if (t.hour != null && (t.hour >= 22 || t.hour < 5)) late++;
    }
    return { sessions: n, late };
  })();

  const firstWeek = weeks.find((w) => w.prompts >= MIN_WEEK_PROMPTS);

  // ── heatmap (measured) ────────────────────────────────────────────────
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ p: 0, f: 0 })));
  for (const s of inScope) {
    for (const t of s.turns) {
      if (t.retry || t.weekday == null || t.hour == null) continue;
      const c = heat[t.weekday][t.hour];
      c.p++;
      if (isFriction(t)) c.f++;
    }
  }

  // ── recent session strips ─────────────────────────────────────────────
  const strips = inScope
    .slice(-8)
    .reverse()
    .map((s) => {
      const t0 = s.firstPrompt;
      const t1 = Math.max(s.end ?? t0, s.lastPrompt ?? t0);
      const span = Math.max(1, t1 - t0);
      const pos = (ts) => Math.min(1, Math.max(0, ((ts ?? t0) - t0) / span));
      const events = [];
      let gave = false;
      for (const t of s.turns) {
        if (t.interrupted) events.push([pos(t.ts + (t.workMs || 0)), 'int']);
        for (let i = 0; i < t.rejections; i++) events.push([pos(t.ts + (t.workMs || 0) / 2), 'rej']);
        if (t.rewind) events.push([pos(t.ts), 'rew']);
        const l = labelFor(labels, s, t);
        if (l?.label === 'action-correction') events.push([pos(t.ts), 'cor']);
        if (l?.label === 'give-up') gave = true;
      }
      const bands = s.turns.flatMap((t) => t.subagents.filter((a) => a.start != null && a.end != null).map((a) => [pos(a.start), pos(a.end)]));
      let out = 'ok';
      let outTxt = 'Ended normally';
      if (gave) [out, outTxt] = ['bad', 'Gave up'];
      else if (s.endedAfter === 'interrupt') [out, outTxt] = ['bad', 'Ended on interrupt'];
      // outcome is how the session ended; an error that was recovered from mid-session doesn't count
      else if (s.endedAfter === 'error') [out, outTxt] = ['infra', s.turns[s.turns.length - 1].authErrors ? 'Ended on auth error' : 'Ended on API error'];
      const pending = s.counts.typed >= MIN_TYPED_FOR_L2 && s.turns.some((t) => !t.retry && !labelFor(labels, s, t));
      return {
        id: s.id.slice(0, 8),
        project: s.project,
        title: s.title,
        when: fmtWhen(t0),
        dur: fmtDuration(t1 - t0),
        durMin: Math.round((t1 - t0) / 60000),
        n: s.counts.typed,
        events,
        bands,
        out,
        outTxt,
        pending,
      };
    });

  // ── delegation (measured) ─────────────────────────────────────────────
  const del = { direct: { p: 0, f: 0 }, delegated: { p: 0, f: 0 } };
  let runsN = 0;
  let runErr = 0;
  let sideCalls = 0;
  let sideErr = 0;
  for (const s of inScope) {
    for (const t of s.turns) {
      if (t.retry) continue;
      const k = t.delegated ? del.delegated : del.direct;
      k.p++;
      k.f += (t.interrupted ? 1 : 0) + t.rejections + (t.rewind ? 1 : 0);
    }
    runsN += s.counts.subagentRuns;
    runErr += s.counts.subagentErrors;
    sideCalls += s.counts.sidechainToolCalls;
    sideErr += s.counts.sidechainToolErrors;
  }
  const delegation = {
    directPer100: round1(per100(del.direct.f, del.direct.p)),
    delegatedPer100: round1(per100(del.delegated.f, del.delegated.p)),
    share: del.direct.p + del.delegated.p ? Math.round((del.delegated.p / (del.direct.p + del.delegated.p)) * 100) : null,
    runs: runsN,
    runErrorRate: runsN ? round1((runErr / runsN) * 100) : null,
    sidechainErrorRate: sideCalls ? round1((sideErr / sideCalls) * 100) : null,
  };

  // ── challenges (estimated) ────────────────────────────────────────────
  const ch = { total: 0, 'revised-with-reason': 0, defended: 0, 'flipped-without-reason': 0 };
  for (const s of inScope) {
    for (const t of s.turns) {
      const l = labelFor(labels, s, t);
      if (l?.label !== 'claim-challenge') continue;
      ch.total++;
      if (ch[l.agentReaction] != null) ch[l.agentReaction]++;
    }
  }

  // ── repeated corrections (estimated) ──────────────────────────────────
  const groups = new Map();
  for (const s of inScope) {
    for (const t of s.turns) {
      const l = labelFor(labels, s, t);
      if (l?.label !== 'action-correction' || !l.ruleCandidate) continue;
      const key = normRule(l.ruleCandidate);
      if (!key) continue;
      const g = groups.get(key) || { text: l.ruleCandidate, times: 0, sessions: new Set(), last: 0, cwds: new Set() };
      g.times++;
      g.sessions.add(s.id);
      g.cwds.add(s.cwd);
      g.last = Math.max(g.last, t.ts || 0);
      groups.set(key, g);
    }
  }
  const mdText = claudeMd ?? claudeMdText(new Set(inScope.map((s) => s.cwd)));
  const rules = [...groups.values()]
    .filter((g) => g.times >= 2)
    .sort((a, b) => b.times - a.times || b.last - a.last)
    .slice(0, 12)
    .map((g) => ({ text: g.text, times: g.times, sessions: g.sessions.size, last: g.last ? fmtDay(g.last) : '', inClaudeMd: ruleInText(g.text, mdText) }));

  // ── freshness of estimates ────────────────────────────────────────────
  let eligible = 0;
  let labelledTurns = 0;
  let unsure = 0;
  let lastClassified = 0;
  const labelModels = new Set();
  for (const s of inScope) {
    if (s.counts.typed < MIN_TYPED_FOR_L2) continue;
    for (const t of s.turns) {
      if (t.retry) continue;
      eligible++;
      const l = labelFor(labels, s, t);
      if (!l) continue;
      labelledTurns++;
      if ((l.confidence ?? 1) < LOW_CONFIDENCE) unsure++;
      if (l.model) labelModels.add(l.model);
    }
    const lf = labels[s.id];
    if (lf?.updatedAt) lastClassified = Math.max(lastClassified, lf.updatedAt);
  }

  // ── classification spend (from the run log) ───────────────────────────
  const runsInScope = runs.filter((r) => r.at >= from && r.kind !== 'selftest');
  const cost = runsInScope.reduce((a, r) => a + (r.costUsd || 0), 0);
  const recent = runs.filter((r) => r.kind !== 'selftest' && r.outputTokens != null).slice(-20);
  const avgOut = recent.length ? Math.round(recent.reduce((a, r) => a + r.outputTokens, 0) / recent.length) : null;

  const typedTotal = inScope.reduce((a, s) => a + s.counts.typed, 0);
  const projects = [...new Set(sessions.map((s) => s.project))].sort();

  return {
    generatedAt: now,
    scope: { project, days, from, to: now, fromLabel: fmtDay(from), toLabel: fmtDay(now), projects },
    totals: {
      sessions: inScope.length,
      typed: typedTotal,
      subagentRuns: runsN,
      apiErrors: inScope.reduce((a, s) => a + s.counts.apiErrors, 0),
      authErrors: inScope.reduce((a, s) => a + s.counts.authErrors, 0),
      retries: inScope.reduce((a, s) => a + s.counts.retries, 0),
    },
    estimates: {
      eligible,
      labelled: labelledTurns,
      pending: eligible - labelledTurns,
      unsure,
      lastClassified: lastClassified || null,
      models: [...labelModels],
    },
    tiles: {
      vibe: vibeNow ? { value: vibeNow.value, partial: vibeNow.partial, delta: lastW && cmpW && lastW !== cmpW ? lastW.score - cmpW.score : null, since: cmpW?.label } : null,
      firstTry,
      interrupts: { per100: round1(allRates.interrupts), delta: firstWeek && lastW && firstWeek !== lastW ? round1(lastW.interrupts - firstWeek.interrupts) : null, since: firstWeek?.label },
      gaveUp,
    },
    score: { weights: SCORE.map(({ key, label, weight, kind }) => ({ key, label, weight, kind })), used: vibeNow?.used || [] },
    weeks,
    marks,
    heat,
    strips,
    delegation,
    challenges: ch.total ? ch : null,
    rules,
    spend: { calls: runsInScope.length, costUsd: Math.round(cost * 1000) / 1000, avgOutputTokens: avgOut, warnHighOutput: avgOut != null && avgOut > 2000 },
    auto: { on: !!config.auto, selftest: config.selftest || null },
    status: status || null,
  };
}
