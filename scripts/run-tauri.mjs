import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { toolchainEnvironment } from './toolchain-environment.mjs';

const child = spawn(
  process.execPath,
  [resolve('node_modules/@tauri-apps/cli/tauri.js'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: toolchainEnvironment() },
);
child.on('error', (error) => {
  console.error(`No se pudo iniciar Tauri: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
