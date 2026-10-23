import {spawn} from 'node:child_process';

const children = new Set();
let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 400).unref();
}

function launch(name, args) {
  const child = spawn(process.execPath, args, {stdio: 'inherit', env: process.env});
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[dev] ${name} exited (${signal || code})`);
    shutdown(code ?? 1);
  });
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] API  http://127.0.0.1:8787');
console.log('[dev] Web  http://127.0.0.1:5173  (已代理 /api)');
launch('api', ['--watch', 'server/index.mjs']);
launch('web', ['node_modules/vite/bin/vite.js']);
