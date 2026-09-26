// Small file helpers: atomic JSON writes, tolerant reads, an error log.
import fs from 'node:fs';
import path from 'node:path';
import { store } from './paths.mjs';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a half-written last line while Claude Code is still appending
    }
  }
  return out;
}

export function logError(where, err) {
  try {
    ensureDir(store.root());
    fs.appendFileSync(store.log(), `${new Date().toISOString()} ${where}: ${err?.stack || err}\n`);
  } catch {
    // never let logging break a hook
  }
}

// --days must be a positive whole number; anything else means the default.
export function parseDays(v, fallback = 84) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const defaultConfig = {
  auto: false,
  consentVersion: null,
  selftest: null, // { ok, ccVersion, at, checks, reason }
  debug: false,
  viewRetentionDays: 30,
};

export function readConfig() {
  return { ...defaultConfig, ...readJson(store.config(), {}) };
}

export function writeConfig(cfg) {
  writeJson(store.config(), cfg);
}
