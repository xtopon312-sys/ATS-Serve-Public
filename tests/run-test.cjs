#!/usr/bin/env node

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TERMINATION_GRACE_MS = 5_000;

function parseTimeout(value) {
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    console.error(`Invalid FLO_TEST_TIMEOUT_MS=${value}: expected a positive integer.`);
    process.exit(2);
  }
  return timeout;
}

function resolveCommand(command, args) {
  if (command !== 'npm') return { command, args };
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  if (process.platform === 'win32') {
    const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(bundledNpmCli)) {
      return { command: process.execPath, args: [bundledNpmCli, ...args] };
    }
  }
  return { command: 'npm', args };
}

function terminateProcessTree(child, signal = 'SIGTERM') {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

const input = process.argv.slice(2);
if (input.length === 0) {
  console.error('Usage: node tests/run-test.cjs <test command> [args...]');
  process.exit(2);
}

const timeoutMs = parseTimeout(process.env.FLO_TEST_TIMEOUT_MS);
const resolved = resolveCommand(input[0], input.slice(1));
const child = spawn(resolved.command, resolved.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false,
  detached: process.platform !== 'win32',
});

let timedOut = false;
let forwardedSignal = null;
const timeout = setTimeout(() => {
  timedOut = true;
  console.error(`[test-runner] Timed out after ${timeoutMs}ms: ${input.join(' ')}`);
  terminateProcessTree(child);
}, timeoutMs);

const forwardSignal = (signal) => {
  if (forwardedSignal) return;
  forwardedSignal = signal;
  terminateProcessTree(child, signal);
  setTimeout(() => terminateProcessTree(child, 'SIGKILL'), TERMINATION_GRACE_MS).unref();
};

process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

child.once('error', (error) => {
  clearTimeout(timeout);
  console.error(`[test-runner] Failed to start ${input[0]}:`, error.message);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  clearTimeout(timeout);
  if (timedOut) process.exit(124);
  if (forwardedSignal || signal) process.exit(128);
  if (code === 77) {
    console.log('  Skipped (ABI mismatch)');
    process.exit(0);
  }
  process.exit(code ?? 1);
});
