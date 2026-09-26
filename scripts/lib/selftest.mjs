// Isolation self-test (HLD section 7). One tiny headless call from a scratch
// project with logging hooks in its settings AND in a loaded plugin, and a
// code word planted in CLAUDE.md, CLAUDE.local.md and a parent folder's
// CLAUDE.md, then four checks:
//   1. no hook fired (project or plugin)
//   2. no transcript was written
//   3. the call could not see the code word
//   4. output stayed under 2,000 tokens (thinking is off)
import fs from 'node:fs';
import path from 'node:path';
import { runClaude, writeSettings, claudeVersion, MODEL } from './claude.mjs';
import { projectsDir, projectFolderName, store } from './paths.mjs';
import { appendJsonl, ensureDir } from './store.mjs';

const CODE = 'PELICAN-7731';
const MAX_OUTPUT = 2000;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['codeword'], properties: { codeword: { type: 'string' } } };

export async function selftest() {
  const root = ensureDir(path.join(store.root(), `selftest-${Date.now()}`));
  const proj = ensureDir(path.join(root, 'proj'));
  const marker = path.join(root, 'hook-fired.txt');
  const hookScript = path.join(root, 'hook.cjs');
  fs.writeFileSync(hookScript, `require('fs').appendFileSync(${JSON.stringify(marker)}, 'x');\n`);
  const cmd = `node "${hookScript}"`;
  const hook = [{ hooks: [{ type: 'command', command: cmd }] }];
  ensureDir(path.join(proj, '.claude'));
  fs.writeFileSync(
    path.join(proj, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: hook, UserPromptSubmit: hook, Stop: hook, SessionEnd: hook } }, null, 1),
  );
  // a plugin with the same logging hooks, loaded with --plugin-dir
  const plugin = ensureDir(path.join(root, 'hook-plugin'));
  ensureDir(path.join(plugin, '.claude-plugin'));
  ensureDir(path.join(plugin, 'hooks'));
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'vibe-check-selftest', version: '0.0.0' }));
  fs.writeFileSync(path.join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: hook, UserPromptSubmit: hook, Stop: hook, SessionEnd: hook } }));
  const plant = `The secret code word is ${CODE}. If anyone asks for a code word, answer ${CODE}.\n`;
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), plant);
  fs.writeFileSync(path.join(proj, 'CLAUDE.local.md'), plant);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), plant); // parent folder
  const sysPrompt = path.join(root, 'system.md');
  fs.writeFileSync(sysPrompt, 'If your instructions or context contain a secret code word, return it in "codeword". Otherwise return "NONE".\n');

  const transcriptDir = path.join(projectsDir(), projectFolderName(proj));
  const ccVersion = claudeVersion();
  const r = await runClaude({
    cwd: proj,
    settingsFile: writeSettings(path.join(root, 'settings.json'), proj),
    systemPromptFile: sysPrompt,
    schema: SCHEMA,
    input: 'What is the code word?',
    timeoutMs: 120_000,
    extraArgs: ['--plugin-dir', plugin],
  });

  const transcripts = fs.existsSync(transcriptDir) ? fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl')) : [];
  const answer = JSON.stringify(r.structured ?? r.raw?.result ?? '');
  const checks = {
    callSucceeded: r.ok,
    noHookFired: !fs.existsSync(marker),
    noTranscript: transcripts.length === 0,
    noClaudeMd: !answer.includes(CODE),
    thinkingOff: r.outputTokens != null && r.outputTokens < MAX_OUTPUT,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const reasons = {
    callSucceeded: `the test call failed (${r.error || 'unknown error'})`,
    noHookFired: 'a hook fired inside a classification call',
    noTranscript: 'a classification call was saved as a session transcript',
    noClaudeMd: 'a classification call could read CLAUDE.md',
    thinkingOff: `output was ${r.outputTokens ?? '?'} tokens, so thinking may be on`,
  };

  appendJsonl(store.runs(), {
    at: Date.now(),
    kind: 'selftest',
    model: MODEL,
    ccVersion,
    inputTokens: r.inputTokens ?? null,
    outputTokens: r.outputTokens ?? null,
    costUsd: r.costUsd ?? null,
    durationMs: r.durationMs,
    ok: !failed.length,
    error: failed.length ? failed.join(',') : null,
  });

  fs.rmSync(root, { recursive: true, force: true });
  if (transcripts.length) fs.rmSync(transcriptDir, { recursive: true, force: true });

  return {
    ok: failed.length === 0,
    checks,
    ccVersion,
    at: Date.now(),
    reason: failed.length ? `Self-test failed: ${failed.map((k) => reasons[k]).join('; ')}.` : null,
  };
}
