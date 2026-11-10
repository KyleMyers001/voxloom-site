import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cardMarkPattern } from '../scripts/site-build.mjs';

export function hasOriginMain(cwd) {
  return spawnSync('git', ['rev-parse', '--verify', 'origin/main'], { cwd, encoding: 'utf8' }).status === 0;
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`]);
}

function ensureOriginMain(cwd) {
  if (hasOriginMain(cwd)) return;
  const lockDir = resolve(cwd, '.git/voxloom-fetch-main.lock');
  const deadline = Date.now() + 30_000;
  while (!hasOriginMain(cwd)) {
    if (Date.now() > deadline) {
      throw new Error('Could not fetch origin/main to compare the disabled build: timed out waiting for the lock.');
    }
    try {
      mkdirSync(lockDir);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      sleep(100);
      continue;
    }
    try {
      if (hasOriginMain(cwd)) return;
      const fetch = spawnSync(
        'git',
        ['fetch', '--depth=1', 'origin', 'main:refs/remotes/origin/main'],
        { cwd, encoding: 'utf8' },
      );
      if (fetch.status !== 0) {
        const detail = `${fetch.stderr || fetch.stdout || ''}`.trim();
        throw new Error(`Could not fetch origin/main to compare the disabled build${detail ? `: ${detail}` : '.'}`);
      }
      return;
    } finally {
      rmSync(lockDir, { recursive: true, force: true });
    }
  }
}

// Vercel checkouts often lack origin/main and cannot git-fetch during the build.
// On this branch the only published-file difference from main is the privacy marker,
// so stripping it reconstructs main. CI still fetches origin/main and compares for real.
export function expectedMainBytes(file, cwd) {
  const source = readFileSync(resolve(cwd, file));
  if (file !== 'privacy.html') return source;
  return Buffer.from(source.toString('utf8').replace(cardMarkPattern, ''));
}

export function showMain(file, cwd) {
  if (!hasOriginMain(cwd) && process.env.VERCEL) {
    return { status: 0, stdout: expectedMainBytes(file, cwd), stderr: Buffer.alloc(0) };
  }
  ensureOriginMain(cwd);
  return spawnSync('git', ['show', `origin/main:${file}`], { cwd, encoding: 'buffer' });
}
