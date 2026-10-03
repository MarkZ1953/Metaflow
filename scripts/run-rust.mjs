import { spawn } from 'node:child_process';
import { toolchainEnvironment } from './toolchain-environment.mjs';

const [command = 'check', ...args] = process.argv.slice(2);
const child = spawn('cargo', [command, '--manifest-path', 'src-tauri/Cargo.toml', ...args], {
  stdio: 'inherit',
  env: toolchainEnvironment(),
});
child.on('error', (error) => {
  console.error(`No se pudo iniciar Cargo: ${error.message}. Instala Rust desde rustup.rs.`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
