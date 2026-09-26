// Session model -> the metrics record stored in data/sessions/<id>.json.
// No prompt text is stored here; text lives only in the compact view.
import crypto from 'node:crypto';
import path from 'node:path';

export const METRICS_VERSION = 1;

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

export function projectName(cwd, file) {
  if (cwd) return path.basename(cwd.replace(/[\\/]+$/, '')) || cwd;
  if (file) return path.basename(path.dirname(file));
  return 'unknown';
}

export function summarize(session) {
  const turns = session.turns.map((t) => {
    const d = t.ts != null ? new Date(t.ts) : null;
    const churn = Object.values(t.edits).filter((c) => c >= 3).length;
    return {
      n: t.n,
      uuid: t.uuid,
      ts: t.ts,
      hour: d ? d.getHours() : null,
      weekday: d ? (d.getDay() + 6) % 7 : null, // Mon = 0
      textHash: hash(t.text),
      textLen: t.text.length,
      waitMs: t.waitMs,
      workMs: t.workMs,
      toolCalls: t.tools.length,
      toolErrors: t.toolErrors.length,
      rejections: t.rejections.length,
      denials: t.denials,
      interrupted: t.interrupted,
      apiErrors: t.apiErrors,
      authErrors: t.authErrors,
      retry: t.retry,
      rewind: t.rewind,
      delegated: t.subagents.length > 0,
      subagents: t.subagents.map((s) => ({
        start: s.startTs,
        end: s.endTs,
        ms: s.startTs != null && s.endTs != null ? s.endTs - s.startTs : null,
        error: s.error,
      })),
      churnFiles: churn,
      reverts: t.reverts,
      slash: t.slash || [],
      endedWith: t.endedWith,
    };
  });

  const sum = (f) => turns.reduce((a, t) => a + (typeof f === 'function' ? f(t) : t[f] || 0), 0);
  const last = turns[turns.length - 1];
  const subagentRuns = turns.flatMap((t) => t.subagents);

  return {
    metricsVersion: METRICS_VERSION,
    id: session.id,
    file: session.file,
    project: projectName(session.cwd, session.file),
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    title: session.title,
    versions: session.versions,
    models: session.models,
    headless: session.headless,
    start: session.start,
    end: session.end,
    firstPrompt: turns[0]?.ts ?? null,
    lastPrompt: last?.ts ?? null,
    turns,
    counts: {
      typed: turns.length,
      scored: turns.filter((t) => !t.retry).length,
      interrupts: sum((t) => (t.interrupted ? 1 : 0)),
      rejections: sum('rejections'),
      denials: sum('denials'),
      rewinds: sum((t) => (t.rewind ? 1 : 0)),
      apiErrors: sum('apiErrors'),
      authErrors: sum('authErrors'),
      retries: sum((t) => (t.retry ? 1 : 0)),
      toolCalls: sum('toolCalls'),
      toolErrors: sum('toolErrors'),
      churnFiles: sum('churnFiles'),
      reverts: sum('reverts'),
      delegatedTurns: sum((t) => (t.delegated ? 1 : 0)),
      subagentRuns: subagentRuns.length,
      subagentErrors: subagentRuns.filter((s) => s.error).length,
      subagentMs: subagentRuns.reduce((a, s) => a + (s.ms || 0), 0),
      sidechainToolCalls: session.sidechain.toolCalls,
      sidechainToolErrors: session.sidechain.toolErrors,
      // a manual /compact writes both a command entry and a boundary; auto-compact only the boundary
      compactions: Math.max(session.compactions, session.slash.compact || 0),
      clears: session.slash.clear || 0,
      rewindCommands: session.slash.rewind || 0,
      permissionModeChanges: session.permissionModeChanges,
    },
    slash: session.slash,
    endedAfter: last?.endedWith ?? null,
    unknownTypes: session.unknownTypes,
  };
}
