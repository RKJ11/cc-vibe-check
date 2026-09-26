// Layer 1 parser: one Claude Code transcript (.jsonl) -> a session model of
// typed turns and behavior events.
//
// Rule: measure behavior only. The only strings matched are ones Claude Code
// itself writes (interrupt marker, rejection text, command wrappers, API error
// flags). The developer's own words are never interpreted here.

const INTERRUPT = '[Request interrupted by user';
const REJECT_MARKERS = ["doesn't want to proceed with this tool use", 'tool use was rejected'];
const INTERRUPTED_TOOL = ["doesn't want to take this action right now", INTERRUPT];
const DENIED_MARKERS = ['Permission for this action was denied', 'permission to use', 'has been denied'];
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const REVERT_CMD = /\bgit\s+(?:checkout\s+(?:\S+\s+)?--|restore\b|reset\s+--hard|revert\b|stash\b(?!\s+list))/;
const KNOWN_TYPES = new Set([
  'user', 'assistant', 'system', 'attachment', 'summary', 'mode', 'permission-mode', 'atis-latch',
  'file-history-snapshot', 'file-history-delta', 'last-prompt', 'ai-title', 'frame-link', 'cost-state',
  'progress', 'queue-operation', 'custom-title', 'tag', 'agent-name',
]);

const ts = (o) => {
  const t = Date.parse(o?.timestamp);
  return Number.isFinite(t) ? t : null;
};

function contentBlocks(o) {
  const c = o?.message?.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
}

function blockText(b) {
  if (!b) return '';
  if (typeof b === 'string') return b;
  if (typeof b.text === 'string') return b.text;
  if (typeof b.content === 'string') return b.content;
  if (Array.isArray(b.content)) return b.content.map(blockText).join('\n');
  return '';
}

export function stripSystemNoise(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .trim();
}

function slashCommand(text) {
  const m = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

const isToolResultEntry = (o) => contentBlocks(o).some((b) => b.type === 'tool_result');

function userText(o) {
  return stripSystemNoise(
    contentBlocks(o)
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n'),
  );
}

// A prompt the developer typed. Newer versions mark it promptSource:"typed",
// and in those transcripts an entry without the marker is injected text (e.g.
// a command's expanded content), never typed. Older versions have no marker
// at all, so fall back to "a user text entry that is not a tool result, meta
// entry, command wrapper or interrupt marker".
function isTypedPrompt(o, text, hasPromptSource) {
  if (o.type !== 'user' || o.isSidechain || o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) return false;
  if (isToolResultEntry(o)) return false;
  if (hasPromptSource ? o.promptSource !== 'typed' : o.promptSource !== undefined) return false;
  if (!text) return false;
  if (text.startsWith(INTERRUPT)) return false;
  if (/^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr)>/.test(text)) return false;
  return true;
}

export const normalizePrompt = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function similarPrompt(a, b) {
  const x = normalizePrompt(a);
  const y = normalizePrompt(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.includes(s) && s.length / l.length >= 0.8;
}

function isAuthError(o, text) {
  const hay = `${o.error || ''} ${o.apiErrorStatus || ''} ${text}`;
  return /authenticat|\b401\b|oauth|\/login|token (?:has )?expired|invalid api key/i.test(hay);
}

function newTurn(n, o, text) {
  return {
    n,
    uuid: o.uuid,
    ts: ts(o),
    text,
    waitMs: null,
    workMs: null,
    durationMs: 0, // from system turn_duration entries, when present
    agentText: [],
    tools: [],
    toolErrors: [],
    rejections: [], // { tool, feedback }
    denials: 0, // permission classifier / policy denials, not the developer
    interrupted: false,
    apiErrors: 0,
    authErrors: 0,
    retry: false,
    rewind: false,
    subagents: [], // { tool, startTs, endTs, error }
    edits: {}, // file -> count within this turn
    reverts: 0,
    lastActivity: ts(o),
    endedWith: null, // 'interrupt' | 'error' | null
  };
}

export function parseTranscript(entries, { file = null, subagentEntries = [], subagentSpans = {} } = {}) {
  const session = {
    id: null,
    file,
    cwd: null,
    gitBranch: null,
    versions: [],
    models: [],
    entrypoint: null,
    headless: false,
    start: null,
    end: null,
    title: null,
    turns: [],
    preTurn: { slash: [] }, // events before the first typed prompt
    slash: {},
    compactions: 0,
    permissionModeChanges: 0,
    unknownTypes: {},
    sidechain: { toolCalls: 0, toolErrors: 0 },
  };

  const children = new Map(); // parentUuid -> number of user/assistant children
  const toolUse = new Map(); // tool_use_id -> { name, turn, startTs, input }
  const versions = new Set();
  const models = new Set();
  let turn = null;
  let lastActivity = null;
  let lastMode = null;
  let typedSeen = false;

  const hasPromptSource = entries.some((o) => o?.type === 'user' && o.promptSource !== undefined);
  const bump = (parent) => children.set(parent, (children.get(parent) || 0) + 1);

  for (const o of entries) {
    if (!o || typeof o !== 'object') continue;
    const t = ts(o);
    if (!KNOWN_TYPES.has(o.type)) session.unknownTypes[o.type] = (session.unknownTypes[o.type] || 0) + 1;
    if (o.sessionId && !session.id) session.id = o.sessionId;
    if (o.cwd && !session.cwd) session.cwd = o.cwd;
    if (o.gitBranch && !session.gitBranch) session.gitBranch = o.gitBranch;
    if (o.version) versions.add(o.version);
    if (o.entrypoint && !session.entrypoint) session.entrypoint = o.entrypoint;
    if (o.promptSource === 'sdk' || /^sdk/.test(o.entrypoint || '')) session.headless = true;
    if (o.type === 'ai-title' && o.aiTitle) session.title = o.aiTitle;
    if (t != null && (o.type === 'user' || o.type === 'assistant' || o.type === 'system')) {
      if (session.start == null || t < session.start) session.start = t;
      if (session.end == null || t > session.end) session.end = t;
    }

    if (o.type === 'permission-mode' || o.type === 'mode') {
      const m = o.permissionMode ?? o.mode;
      if (o.type === 'permission-mode') {
        if (lastMode != null && m !== lastMode) session.permissionModeChanges++;
        lastMode = m;
      }
      continue;
    }

    if (o.type === 'system') {
      if (o.subtype === 'compact_boundary') session.compactions++;
      if (o.subtype === 'turn_duration' && turn && Number.isFinite(o.durationMs)) turn.durationMs += o.durationMs;
      continue;
    }

    if (o.isSidechain) {
      countSidechain(session, o);
      continue;
    }

    if (o.type !== 'user' && o.type !== 'assistant') continue;

    // --- user entries ---------------------------------------------------
    if (o.type === 'user') {
      const text = userText(o);
      if (o.isCompactSummary) continue;

      if (isTypedPrompt(o, text, hasPromptSource)) {
        const prev = turn;
        const rewind = o.parentUuid != null && (children.get(o.parentUuid) || 0) > 0;
        if (o.parentUuid != null) bump(o.parentUuid);
        turn = newTurn(session.turns.length + 1, o, text);
        turn.rewind = rewind;
        if (lastActivity != null && turn.ts != null) turn.waitMs = Math.max(0, turn.ts - lastActivity);
        if (prev && prev.endedWith === 'error' && similarPrompt(prev.text, text)) turn.retry = true;
        session.turns.push(turn);
        typedSeen = true;
        lastActivity = turn.ts;
        continue;
      }
      if (o.parentUuid != null) bump(o.parentUuid);
      if (o.isMeta) continue;

      const cmd = slashCommand(text);
      if (cmd) {
        session.slash[cmd] = (session.slash[cmd] || 0) + 1;
        (typedSeen && turn ? (turn.slash ||= []) : session.preTurn.slash).push(cmd);
        continue;
      }

      if (text.startsWith(INTERRUPT)) {
        if (turn) {
          turn.interrupted = true;
          turn.endedWith = 'interrupt';
          if (t != null) turn.lastActivity = t;
        }
        continue;
      }

      for (const b of contentBlocks(o)) {
        if (b.type !== 'tool_result') continue;
        const use = toolUse.get(b.tool_use_id);
        const body = blockText(b);
        if (t != null) lastActivity = t;
        if (turn && t != null) turn.lastActivity = t;
        if (use?.subagent) {
          use.subagent.endTs = t;
          use.subagent.error = !!b.is_error;
        }
        if (!b.is_error || !turn) continue;
        if (INTERRUPTED_TOOL.some((m) => body.includes(m))) {
          turn.interrupted = true;
          turn.endedWith = 'interrupt';
        } else if (REJECT_MARKERS.some((m) => body.includes(m))) {
          const said = /the user said:\s*([\s\S]*)$/i.exec(body);
          turn.rejections.push({ tool: use?.name || null, feedback: said ? said[1].trim() : null });
          turn.endedWith = null;
        } else if (DENIED_MARKERS.some((m) => body.includes(m))) {
          turn.denials++;
        } else {
          turn.toolErrors.push({ tool: use?.name || null, line: firstLine(body) });
        }
      }
      continue;
    }

    // --- assistant entries ----------------------------------------------
    if (o.parentUuid != null) bump(o.parentUuid);
    const model = o.message?.model;
    if (model && model !== '<synthetic>') models.add(model);
    if (t != null) lastActivity = t;
    if (!turn) continue;
    if (t != null) turn.lastActivity = t;

    const blocks = contentBlocks(o);
    if (o.isApiErrorMessage || o.error) {
      const text = blocks.map(blockText).join(' ');
      turn.apiErrors++;
      if (isAuthError(o, text)) turn.authErrors++;
      turn.endedWith = 'error';
      continue;
    }

    for (const b of blocks) {
      if (b.type === 'text' && b.text?.trim()) {
        turn.agentText.push(b.text.trim());
        turn.endedWith = null;
      } else if (b.type === 'tool_use') {
        turn.tools.push(b.name);
        turn.endedWith = null;
        const rec = { name: b.name, turn: turn.n };
        if (SUBAGENT_TOOLS.has(b.name)) {
          rec.subagent = { tool: b.name, id: b.id, startTs: t, endTs: null, error: false };
          turn.subagents.push(rec.subagent);
        }
        const fp = b.input?.file_path || b.input?.notebook_path;
        if (EDIT_TOOLS.has(b.name) && fp) turn.edits[fp] = (turn.edits[fp] || 0) + 1;
        if (b.name === 'Bash' && REVERT_CMD.test(String(b.input?.command || ''))) turn.reverts++;
        toolUse.set(b.id, rec);
      }
    }
  }

  for (const e of subagentEntries) countSidechain(session, e);
  // prefer the subagent's own span: a background agent's tool_result is only the launch ack
  for (const tr of session.turns) {
    for (const s of tr.subagents) {
      const span = subagentSpans[s.id];
      if (!span) continue;
      s.startTs = Math.min(s.startTs ?? span.start, span.start);
      s.endTs = Math.max(s.endTs ?? span.end, span.end);
    }
  }

  for (const tr of session.turns) {
    tr.workMs = tr.durationMs || (tr.lastActivity != null && tr.ts != null ? Math.max(0, tr.lastActivity - tr.ts) : null);
  }

  session.versions = [...versions];
  session.models = [...models];
  return session;
}

function countSidechain(session, o) {
  for (const b of contentBlocks(o)) {
    if (o.type === 'assistant' && b.type === 'tool_use') session.sidechain.toolCalls++;
    if (o.type === 'user' && b.type === 'tool_result' && b.is_error) session.sidechain.toolErrors++;
  }
}

function firstLine(s) {
  const line = String(s || '').split('\n').find((l) => l.trim()) || '';
  return line.trim().slice(0, 200);
}
