import {describe, expect, it} from 'vitest';

import {buildArgv, resolveExecutable, runAgent, stripAnsi, tokenizeCommand} from './agent-runner';

describe('tokenizeCommand', () => {
  it('splits on whitespace', () => {
    expect(tokenizeCommand('hermes -z {prompt}')).toEqual(['hermes', '-z', '{prompt}']);
  });
  it('honors double quotes', () => {
    expect(tokenizeCommand('tool --dir "/tmp/my dir" {prompt}')).toEqual([
      'tool',
      '--dir',
      '/tmp/my dir',
      '{prompt}',
    ]);
  });
  it('honors single quotes and backslashes', () => {
    expect(tokenizeCommand("tool --x 'a b' c\\ d")).toEqual(['tool', '--x', 'a b', 'c d']);
  });
  it('rejects unterminated quotes', () => {
    expect(() => tokenizeCommand('tool "unterminated')).toThrow('Unterminated');
  });
});

describe('buildArgv', () => {
  it('substitutes the prompt as a single argument', () => {
    const {argv} = buildArgv('hermes -z {prompt}', 'fix the bug\nwith newlines');
    expect(argv).toEqual(['hermes', '-z', 'fix the bug\nwith newlines']);
  });
  it('appends the prompt when no token present', () => {
    const {argv} = buildArgv('codex exec', 'do the thing');
    expect(argv).toEqual(['codex', 'exec', 'do the thing']);
  });
  it('keeps the prompt intact even with shell-looking characters', () => {
    const prompt = 'a"; rm -rf /; "$(whoami)`id`';
    const {argv} = buildArgv('claude -p {prompt}', prompt);
    expect(argv[2]).toBe(prompt);
  });
});

describe('stripAnsi', () => {
  it('removes color and cursor sequences', () => {
    expect(stripAnsi('[31mred[0m plain')).toBe('red plain');
  });
});

describe('resolveExecutable', () => {
  it('resolves absolute paths that are executable', () => {
    expect(resolveExecutable('/bin/echo')).toBe('/bin/echo');
  });
  it('returns null for missing binaries', () => {
    expect(resolveExecutable('definitely-not-a-real-binary-xyz-123')).toBeNull();
  });
});

describe('runAgent', () => {
  it('captures stdout and exit code', async () => {
    const result = await runAgent({
      command: `${process.execPath} -e "process.stdout.write('agent-done')" {prompt}`,
      cwd: '/',
      prompt: 'ignored',
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('agent-done');
  });

  it('fails cleanly for an unknown command', async () => {
    const result = await runAgent({
      command: 'definitely-not-a-real-binary-xyz-123 --flag {prompt}',
      cwd: '/',
      prompt: 'hi',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Command not found');
  });

  it('reports non-zero exit codes', async () => {
    const result = await runAgent({
      command: `${process.execPath} -e "process.exit(3)" {prompt}`,
      cwd: '/',
      prompt: 'ignored',
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('rejects a missing cwd', async () => {
    const result = await runAgent({
      command: `${process.execPath} -e "1" {prompt}`,
      cwd: '/definitely/not/a/real/path/xyz',
      prompt: 'hi',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not exist');
  });
});
