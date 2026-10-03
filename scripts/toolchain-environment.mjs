import { existsSync } from 'node:fs';
import { resolve, delimiter, dirname } from 'node:path';

export function toolchainEnvironment() {
  const environment = { ...process.env };
  // Preserve the existing Windows Path key instead of creating a second PATH key.
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] = `${dirname(process.execPath)}${delimiter}${environment[pathKey] ?? ''}`;
  const localCargo = resolve('.tools/cargo');
  if (existsSync(resolve(localCargo, 'bin/cargo.exe'))) {
    environment.CARGO_HOME = localCargo;
    environment.RUSTUP_HOME = resolve('.tools/rustup');
    environment[pathKey] = `${resolve(localCargo, 'bin')}${delimiter}${environment[pathKey]}`;
  }
  return environment;
}
