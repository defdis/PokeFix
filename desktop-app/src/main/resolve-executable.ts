/** Locate a CLI binary on PATH (plus well-known install dirs for GUI launches). */
import fs from 'fs';
import os from 'os';
import path from 'path';

export function resolveExecutable(command: string): string | null {
  const candidateDirs = [
    ...String(process.env.PATH ?? '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.hermes', 'hermes-agent', '.hermes', 'bin'),
  ].filter(Boolean);
  const isExecutable = (file: string): boolean => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes('/')) {
    return isExecutable(command) ? command : null;
  }
  for (const dir of new Set(candidateDirs)) {
    const full = path.join(dir, command);
    if (isExecutable(full)) {
      return full;
    }
  }
  return null;
}
