import { spawnSync } from 'node:child_process';

export function showMain(file, cwd) {
  const show = () => spawnSync('git', ['show', `origin/main:${file}`], { cwd, encoding: 'buffer' });
  let result = show();
  if (result.status !== 0) {
    const fetch = spawnSync('git', ['fetch', '--depth=1', 'origin', 'main'], { cwd, encoding: 'utf8' });
    if (fetch.status !== 0) {
      const detail = `${fetch.stderr || fetch.stdout || ''}`.trim();
      throw new Error(`Could not fetch origin/main to compare the disabled build${detail ? `: ${detail}` : '.'}`);
    }
    result = show();
  }
  return result;
}
