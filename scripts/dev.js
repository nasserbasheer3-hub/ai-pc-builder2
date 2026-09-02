import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = process.cwd();
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');

function ensureInstalled(dir) {
  return fs.existsSync(path.join(dir, 'node_modules'));
}

if (!ensureInstalled(backendDir) || !ensureInstalled(frontendDir)) {
  console.log('Installing dependencies (first run)...');
  spawn('npm', ['run', 'install:all'], { stdio: 'inherit', shell: true });
}

const backend = spawn('npm', ['--prefix', backendDir, 'run', 'dev'], { stdio: 'inherit', shell: true });
const frontend = spawn('npm', ['--prefix', frontendDir, 'run', 'dev'], { stdio: 'inherit', shell: true });

function shutdown(sig) {
  backend.kill(sig);
  frontend.kill(sig);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
