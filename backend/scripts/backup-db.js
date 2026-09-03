#!/usr/bin/env node
// Online SQLite backup (safe while the server is running) with simple
// retention. Usage: node scripts/backup-db.js  (env: DATABASE_PATH, BACKUP_DIR)
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || new URL('../data/gaming_platform.db', import.meta.url).pathname;
const backupDir = process.env.BACKUP_DIR || new URL('../backups', import.meta.url).pathname;
const keep = Number(process.env.BACKUP_KEEP || 14);

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `gaming_platform-${stamp}.db`);

const src = new Database(dbPath, { readonly: true });
try {
  src.prepare('VACUUM INTO ?').run(target);
} finally {
  src.close();
}

// Retention: drop the oldest backups beyond `keep`.
const files = readdirSync(backupDir)
  .filter((f) => f.startsWith('gaming_platform-') && f.endsWith('.db'))
  .map((f) => join(backupDir, f))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
while (files.length > keep) rmSync(files.shift(), { force: true });

console.log(`[backup] ${target} (${(statSync(target).size / 1024).toFixed(0)} KB), kept ${keep}`);
