// Session model -> compact text view, the only input Layer 2 ever sees.
// Keeps full typed prompts, a head and tail of each reply, one line per tool
// kind, the first line of each error, and the behavior around each turn.
import { redact } from './redact.mjs';

const PROMPT_CAP = 4000;
const HEAD = 300;
const TAIL = 200;

export function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const quote = (s) => `"${oneLine(s).replace(/"/g, "'")}"`;

function agentSummary(texts) {
  const all = oneLine(texts.join(' '));
  if (!all) return null;
  if (all.length <= HEAD + TAIL + 20) return quote(all);
  return `${quote(all.slice(0, HEAD))} … ${quote(all.slice(-TAIL))}`;
}

function toolSummary(tools) {
  if (!tools.length) return 'tools:0';
  const counts = {};
  for (const t of tools) counts[t] = (counts[t] || 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => (v > 1 ? `${k}×${v}` : k));
  return `tools:${tools.length} ${parts.join(',')}`;
}

export function compactView(session, { project } = {}) {
  const out = [];
  const v = session.versions[session.versions.length - 1] || '?';
  out.push(`# Session ${String(session.id).slice(0, 8)} · project ${project || '?'} · ${session.turns.length} typed prompts · Claude Code ${v}`);
  for (const t of session.turns) {
    let prompt = oneLine(t.text);
    if (prompt.length > PROMPT_CAP) prompt = `${prompt.slice(0, PROMPT_CAP)} …[cut]`;
    const flags = [`wait:${fmtDuration(t.waitMs)}`];
    if (t.rewind) flags.push('after-rewind');
    if (t.retry) flags.push('retry-after-api-error');
    // retries are never labelled; don't pay for the same prompt twice
    const shown = t.retry ? `(same prompt as T${t.n - 1}, resent after the API error)` : redact(prompt);
    out.push(`T${t.n} USER: ${shown}   {${flags.join(' · ')}}`);

    const meta = [toolSummary(t.tools), `work:${fmtDuration(t.workMs)}`];
    if (t.subagents.length) meta.push(`subagents:${t.subagents.length}`);
    if (Object.values(t.edits).some((c) => c >= 3)) meta.push('same-file-edited-3+');
    if (t.reverts) meta.push(`git-revert-cmds:${t.reverts}`);
    const said = agentSummary(t.agentText);
    out.push(`   AGENT: ${said ? redact(said) : '(no text reply)'}   {${meta.join(' · ')}}`);

    for (const r of t.rejections) {
      out.push(`   [developer rejected ${r.tool || 'a tool call'}${r.feedback ? ` and said: ${redact(quote(r.feedback.slice(0, 600)))}` : ''}]`);
    }
    for (const e of t.toolErrors.slice(0, 3)) out.push(`   [tool error${e.tool ? ` in ${e.tool}` : ''}: ${redact(e.line)}]`);
    if (t.toolErrors.length > 3) out.push(`   [+${t.toolErrors.length - 3} more tool errors]`);
    if (t.subagents.some((s) => s.error)) out.push('   [a subagent run failed]');
    if (t.apiErrors) out.push(`   [API error${t.authErrors ? ' (login/auth)' : ''} ×${t.apiErrors}]`);
    if (t.interrupted) out.push('   [developer interrupted the agent]');
    for (const c of t.slash || []) out.push(`   [developer ran /${c}]`);
  }
  return out.join('\n') + '\n';
}
