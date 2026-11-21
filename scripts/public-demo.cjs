'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'dist', 'main', 'server.js')) ||
    !fs.existsSync(path.join(root, 'frontend', 'out', 'index.html'))) {
  console.error('Execute npm run build e npm run build:frontend antes da demonstração.');
  process.exit(1);
}
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'LANG', 'LC_ALL', 'COMSPEC', 'PATHEXT', 'DISPLAY']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  ELECTRON_RUN_AS_NODE: '1', E2E_TASK_LOCAL_PORTS: '1', E2E_FRESH_SETUP: '1',
  E2E_BASE_URL: 'http://127.0.0.1:13001',
  E2E_KDS_BASE_URL: 'http://127.0.0.1:13002',
  E2E_SERVER_APP_BASE_URL: 'http://127.0.0.1:13003',
  NODE_ENV: 'test'
});
console.log('Demonstração local: http://127.0.0.1:13001 (somente este computador).');
console.log('Dados temporários de teste. Não utilizar para operação comercial.');
console.log('Pressione Ctrl+C para encerrar.');
const child = spawn(require('electron'), [path.join(root, 'tests', 'e2e-server.cjs')], {
  cwd: root, env, stdio: 'inherit', windowsHide: true
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
