// Cross-platform dev launcher: runs the Next.js app and the Mint docs server
// together. Next.js is required; docs are best-effort so a Mint failure does not
// stop the marketing site from running.
import { spawn } from 'node:child_process';
import process from 'node:process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const web = spawn('next', ['dev'], { stdio: 'inherit', shell: true });
const docs = spawn(npx, ['--yes', 'mint@latest', 'dev', '--port', '3002', '--no-open'], {
  stdio: 'inherit',
  shell: true,
  cwd: 'docs',
});

const procs = [web, docs];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill('SIGTERM');
  }
  process.exit(code);
}

web.on('exit', (code) => shutdown(code ?? 0));

docs.on('exit', (code) => {
  if (shuttingDown) return;
  if (code === 0) return;
  console.warn(
    `\n[dev] Mint docs exited (${code ?? 'unknown'}). Web dev continues at http://localhost:3000\n` +
      '[dev] Run docs alone with: npm run docs:dev\n',
  );
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
