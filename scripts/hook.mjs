#!/usr/bin/env node
// SessionEnd hook. Must be silent and exit in well under a second: it only
// starts a detached worker and returns. Costs no tokens.
import { spawn } from 'node:child_process';
import { asset } from './lib/paths.mjs';
import { logError } from './lib/store.mjs';

// Loop guard: our own classification calls must never trigger more work.
if (process.env.VIBECHECK_CHILD) process.exit(0);

let input = '';
const done = () => {
  let transcript = '';
  try {
    transcript = JSON.parse(input || '{}').transcript_path || '';
  } catch {
    // no payload: the worker just scans for changed transcripts
  }
  try {
    const args = [asset.script('vibe-check.mjs'), '_after-session'];
    if (transcript) args.push(transcript);
    spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (err) {
    logError('hook', err);
  }
  process.exit(0);
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', done);
process.stdin.on('error', done);
setTimeout(done, 500); // never wait on a stdin that doesn't close
