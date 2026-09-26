#!/usr/bin/env node
// Live L2 eval: runs the real classifier (headless Haiku, same guards as
// production) on hand-labelled sessions several times and reports the v0.2
// exit criteria. SPENDS TOKENS: about $0.007 per call.
//
//   node tests/eval/run-eval.mjs [--runs 3]
//
// Extra private cases (real transcripts must never be committed): set
// VIBECHECK_EVAL_DIR to a folder of <name>.jsonl + <name>.labels.json.
// A hand label may be a string or an array of acceptable labels.
//
// Exit criteria (HLD v0.2): correction precision >= 0.8, >= 90% of turns
// labelled identically across runs, < 2,000 output tokens per 11-turn call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../../scripts/lib/transcript.mjs';
import { compactView } from '../../scripts/lib/view.mjs';
import { readJsonl, readJson } from '../../scripts/lib/store.mjs';
import { runClaude, writeSettings, MODEL } from '../../scripts/lib/claude.mjs';
import { validateLabels } from '../../scripts/classify.mjs';
import { asset } from '../../scripts/lib/paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, '..', 'fixtures');
const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 3;

// Each case: a fixture transcript + hand labels keyed by turn number.
const caseDirs = [fx, process.env.VIBECHECK_EVAL_DIR].filter(Boolean);
const CASES = caseDirs.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.labels.json'))
    .map((f) => ({ name: f.replace('.labels.json', ''), dir, hand: readJson(path.join(dir, f)) })),
);
const accepted = (h) => (Array.isArray(h.label) ? h.label : [h.label]);
const perCase = {};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-eval-'));
const settingsFile = writeSettings(path.join(work, '..', `vc-eval-settings-${process.pid}.json`), work);
const schema = readJson(asset.labelsSchema());

let tp = 0, fp = 0, fn = 0, labelOk = 0, labelN = 0, agree = 0, agreeN = 0;
const outTokens = [];
let cost = 0;

for (const c of CASES) {
  const session = parseTranscript(readJsonl(path.join(c.dir, `${c.name}.jsonl`)));
  const view = compactView(session, { project: 'eval' });
  const turns = Object.keys(c.hand).map(Number);
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await runClaude({
      cwd: work,
      settingsFile,
      systemPromptFile: asset.classifierPrompt(),
      schema,
      input: `${view}\n---\nLabel exactly these turns: ${turns.map((n) => `T${n}`).join(', ')}\n`,
    });
    if (!r.ok) console.log(`  ${c.name} run ${i + 1}: ${r.error}`);
    const { got, missing } = validateLabels(r.structured, turns);
    if (r.outputTokens != null) outTokens.push(r.outputTokens);
    cost += r.costUsd || 0;
    runs.push(got);
    console.log(`${c.name} run ${i + 1}: ${got.size}/${turns.length} labelled, ${r.outputTokens ?? '?'} output tokens, ${(r.durationMs / 1000).toFixed(1)}s${missing.length ? `, missing ${missing.join(',')}` : ''}`);
    const pc = (perCase[c.name] ||= { ok: 0, n: 0 });
    for (const n of turns) {
      const want = accepted(c.hand[n]);
      const have = got.get(n)?.label;
      labelN++;
      pc.n++;
      if (want.includes(have)) {
        labelOk++;
        pc.ok++;
      } else console.log(`    T${n}: expected ${want.join('|')}, got ${have ?? 'nothing'}`);
      const isCorr = want.includes('action-correction');
      if (have === 'action-correction' && isCorr) tp++;
      else if (have === 'action-correction') fp++;
      else if (isCorr) fn++;
    }
  }
  for (const n of turns) {
    const seen = runs.map((g) => g.get(n)?.label ?? '-');
    agreeN++;
    if (seen.every((x) => x === seen[0])) agree++;
  }
}

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(settingsFile, { force: true });

const precision = tp + fp ? tp / (tp + fp) : 1;
const agreement = agreeN ? agree / agreeN : 1;
const maxOut = outTokens.length ? Math.max(...outTokens) : null;
const pass = (b) => (b ? 'PASS' : 'FAIL');
console.log(`\nModel ${MODEL}, ${CASES.length} case(s) × ${RUNS} runs, total cost $${cost.toFixed(4)}`);
for (const [k, v] of Object.entries(perCase)) console.log(`  ${k.padEnd(28)} ${(100 * v.ok / v.n).toFixed(1)}% of ${v.n / RUNS} turns`);
console.log(`Label accuracy          ${(100 * labelOk / labelN).toFixed(1)}%`);
console.log(`Correction precision    ${precision.toFixed(2)}  (recall ${(tp + fn ? tp / (tp + fn) : 1).toFixed(2)})  ${pass(precision >= 0.8)}`);
console.log(`Cross-run agreement     ${(100 * agreement).toFixed(1)}%  ${pass(agreement >= 0.9)}`);
console.log(`Max output tokens/call  ${maxOut ?? '?'}  ${pass(maxOut != null && maxOut < 2000)}`);
process.exitCode = precision >= 0.8 && agreement >= 0.9 && maxOut != null && maxOut < 2000 ? 0 : 1;
