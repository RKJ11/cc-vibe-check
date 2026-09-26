// Tests against a real Claude Code 2.1.283 transcript layout (anonymised to a
// structural skeleton): a headless session that launched a background
// subagent. Subagents live in <session>/subagents/agent-<id>.jsonl + .meta.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real-2.1.283-subagent');
const ID = '640d6ae2-cc49-4e0b-9109-b866445a86c5';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-real-'));
process.env.VIBECHECK_HOME = path.join(tmp, 'store');
process.env.VIBECHECK_PROJECTS_DIR = path.join(tmp, 'projects');
const { extractFile } = await import('../scripts/extract.mjs');

// Same transcript with its prompt marked typed, as if a developer ran it.
function asTyped() {
  const dir = path.join(tmp, 'projects', '-work-probe');
  fs.cpSync(src, dir, { recursive: true });
  const f = path.join(dir, `${ID}.jsonl`);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const o of lines) {
    if (o.promptSource === 'sdk') o.promptSource = 'typed';
    if (o.entrypoint) o.entrypoint = 'cli';
  }
  fs.writeFileSync(f, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return f;
}

test('real headless transcript is skipped by L1', () => {
  const r = extractFile(path.join(src, `${ID}.jsonl`));
  assert.equal(r.skipped, 'headless');
});

test('real subagent layout: run counted, span from the subagent file, sidechain tools counted', () => {
  const r = extractFile(asTyped());
  const c = r.metrics.counts;
  assert.equal(r.skipped, null);
  assert.equal(c.typed, 1);
  assert.equal(c.subagentRuns, 1);
  assert.equal(c.delegatedTurns, 1);
  assert.ok(c.sidechainToolCalls >= 1, 'Glob inside the subagent');
  assert.ok(c.subagentMs > 1000, `background agent span should be seconds, got ${c.subagentMs} ms`);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
