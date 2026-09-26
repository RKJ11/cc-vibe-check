// Where things live. Every path can be redirected with an env var so tests
// never touch the real ~/.claude folders.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

export function projectsDir() {
  return process.env.VIBECHECK_PROJECTS_DIR || path.join(claudeHome(), 'projects');
}

export function storeDir() {
  return process.env.VIBECHECK_HOME || path.join(claudeHome(), 'vibe-check');
}

export function userClaudeMd() {
  return path.join(claudeHome(), 'CLAUDE.md');
}

export const store = {
  root: () => storeDir(),
  sessions: () => path.join(storeDir(), 'data', 'sessions'),
  labels: () => path.join(storeDir(), 'data', 'labels'),
  state: () => path.join(storeDir(), 'data', 'state.json'),
  views: () => path.join(storeDir(), 'views'),
  work: () => path.join(storeDir(), 'work'),
  runs: () => path.join(storeDir(), 'runs.jsonl'),
  config: () => path.join(storeDir(), 'config.json'),
  status: () => path.join(storeDir(), 'status.json'),
  lock: () => path.join(storeDir(), 'classify.lock'),
  dashboard: () => path.join(storeDir(), 'dashboard.html'),
  log: () => path.join(storeDir(), 'errors.log'),
};

export const asset = {
  classifierPrompt: () => path.join(PLUGIN_ROOT, 'prompts', 'classifier.md'),
  labelsSchema: () => path.join(PLUGIN_ROOT, 'schema', 'labels.schema.json'),
  script: (name) => path.join(PLUGIN_ROOT, 'scripts', name),
};

// Claude Code names a project folder after its cwd with every non-alphanumeric
// character replaced by "-" (O:\cc-vibe-check -> O--cc-vibe-check).
export function projectFolderName(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
