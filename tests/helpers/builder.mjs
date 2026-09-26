// Builds synthetic Claude Code transcripts with the entry shapes seen on
// Claude Code 2.1.283 (field names only, no real content).
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export class Tx {
  constructor({ sessionId = 'sess-0001', cwd = '/work/demo', start = '2026-09-22T09:00:00Z', version = '2.1.283', promptSource = true } = {}) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.t = Date.parse(start);
    this.version = version;
    this.withPromptSource = promptSource;
    this.entries = [];
    this.last = null;
  }

  base(type, extra = {}) {
    const e = {
      parentUuid: this.last,
      isSidechain: false,
      type,
      uuid: uid(),
      timestamp: new Date(this.t).toISOString(),
      userType: 'external',
      entrypoint: 'cli',
      cwd: this.cwd,
      sessionId: this.sessionId,
      version: this.version,
      gitBranch: 'main',
      ...extra,
    };
    this.entries.push(e);
    this.last = e.uuid;
    return e;
  }

  wait(min) {
    this.t += Math.round(min * 60_000);
    return this;
  }

  raw(obj) {
    this.entries.push(obj);
    return this;
  }

  mode(permissionMode) {
    this.entries.push({ type: 'permission-mode', permissionMode, sessionId: this.sessionId });
    return this;
  }

  typed(text, waitMin = 1) {
    this.wait(waitMin);
    const extra = { message: { role: 'user', content: text }, permissionMode: 'default' };
    if (this.withPromptSource) extra.promptSource = 'typed';
    return this.base('user', extra);
  }

  meta(text) {
    return this.base('user', { isMeta: true, message: { role: 'user', content: text } });
  }

  slash(name, args = '') {
    this.wait(0.2);
    return this.base('user', {
      message: { role: 'user', content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>` },
    });
  }

  say(text, min = 0.5) {
    this.wait(min);
    return this.base('assistant', {
      message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] },
    });
  }

  tool(name, input = {}, { result = 'ok', isError = false, min = 0.3 } = {}) {
    this.wait(min);
    const id = `toolu_${uid().slice(-8)}`;
    const a = this.base('assistant', {
      message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] },
    });
    this.wait(min);
    this.base('user', {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }] },
      sourceToolAssistantUUID: a.uuid,
    });
    return this;
  }

  reject(name, input = {}, feedback = null) {
    const body = feedback
      ? `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n${feedback}`
      : "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
    return this.tool(name, input, { result: body, isError: true });
  }

  interrupt(forTool = false) {
    this.wait(0.1);
    return this.base('user', {
      message: { role: 'user', content: [{ type: 'text', text: forTool ? '[Request interrupted by user for tool use]' : '[Request interrupted by user]' }] },
    });
  }

  apiError({ auth = false } = {}) {
    this.wait(0.1);
    return this.base('assistant', {
      isApiErrorMessage: true,
      error: auth ? 'authentication_failed' : 'unknown',
      apiErrorStatus: auth ? 401 : 529,
      message: {
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: auth ? 'API Error: 401 · Please run /login' : 'API Error: 529 Overloaded' }],
      },
    });
  }

  turnDuration(ms) {
    return this.base('system', { subtype: 'turn_duration', durationMs: ms, isMeta: false });
  }

  compactBoundary() {
    return this.base('system', { subtype: 'compact_boundary', content: 'Conversation compacted' });
  }

  sidechainToolError() {
    this.entries.push({ isSidechain: true, type: 'user', uuid: uid(), sessionId: this.sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'boom', is_error: true }] } });
    return this;
  }

  // Next entry will branch from `uuid`, as /rewind does.
  rewindTo(uuid) {
    this.last = uuid;
    return this;
  }

  jsonl() {
    return this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  }
}
