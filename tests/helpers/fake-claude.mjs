#!/usr/bin/env node
// Stand-in for `claude` in tests. Behaviour is driven by env vars:
//   FAKE_LOG      append one JSON line per call: { args, env, cwd, input }
//   FAKE_LABELS   JSON file { "<turn>": {label,tone,agentReaction,confidence,ruleCandidate} }
//   FAKE_DROP     "1": omit the last requested turn on the first call per session
//   FAKE_TOKENS   output token count to report (default 900)
//   FAKE_FAIL     "1": exit 1 with no JSON
//   FAKE_MODE     garbage | text | error | hang
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.283 (Claude Code)');
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const env = process.env;
  if (env.FAKE_LOG) {
    fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), input, env: { VIBECHECK_CHILD: env.VIBECHECK_CHILD, MAX_THINKING_TOKENS: env.MAX_THINKING_TOKENS } }) + '\n');
  }
  if (env.FAKE_MODE === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  if (env.FAKE_MODE === 'error') {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low', usage: { input_tokens: 0, output_tokens: 0 } }));
    return;
  }
  if (env.FAKE_FAIL === '1') {
    process.stderr.write('boom');
    process.exit(1);
  }
  const usage = { input_tokens: 2200, output_tokens: Number(env.FAKE_TOKENS || 900) };
  const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);

  let structured;
  if (schema.properties.codeword) {
    structured = { codeword: 'NONE' };
  } else {
    const m = /Label exactly these turns: (.*)$/m.exec(input);
    let turns = m ? m[1].split(',').map((s) => Number(s.trim().replace(/^T/, ''))) : [];
    const session = /^# Session (\S+)/m.exec(input)?.[1] || 'x';
    if (env.FAKE_DROP === '1' && env.FAKE_LOG) {
      const calls = fs.readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter((l) => l.includes(`# Session ${session}`)).length;
      if (calls === 1) turns = turns.slice(0, -1);
    }
    const hand = env.FAKE_LABELS ? JSON.parse(fs.readFileSync(env.FAKE_LABELS, 'utf8')) : {};
    structured = {
      labels: turns.map((turn) => ({ turn, label: 'new-request', tone: 'neutral', agentReaction: null, confidence: 0.9, ruleCandidate: null, ...(hand[turn] || {}) })),
    };
  }
  if (env.FAKE_MODE === 'garbage') structured = { labels: [{ turn: 'x', label: 'angry' }, 'nope', null] };
  if (env.FAKE_MODE === 'text') {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Here you go: ' + JSON.stringify(structured), usage, total_cost_usd: 0.007 }));
    return;
  }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured, usage, total_cost_usd: 0.007 }));
});
