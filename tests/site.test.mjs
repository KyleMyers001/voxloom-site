import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://voxloom-site-seven.vercel.app';
const pages = ['index.html', 'download.html', 'privacy.html', 'changelog.html'];

for (const page of pages) {
  test(`${page}: metadata, local links and launch copy are valid`, () => {
    const html = readFileSync(resolve(root, page), 'utf8');
    assert.doesNotMatch(html, /PLACEHOLDER|download-pending/);
    const url = `${origin}/${page === 'index.html' ? '' : page}`;
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    assert.ok(html.includes(`<meta property="og:url" content="${url}">`));
    for (const imageTag of [
      `<meta property="og:image" content="${origin}/assets/og.png">`,
      `<meta name="twitter:image" content="${origin}/assets/og.png">`,
    ]) assert.ok(html.includes(imageTag));
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const link = new URL(ref, `${origin}/${page}`);
      if (link.origin !== origin) continue;
      const target = resolve(root, `.${decodeURIComponent(link.pathname === '/' ? '/index.html' : link.pathname)}`);
      assert.ok(existsSync(target), `${page}: missing link target ${ref}`);
      if (link.hash) {
        const body = readFileSync(target, 'utf8');
        assert.ok(body.includes(`id="${link.hash.slice(1)}"`), `${page}: missing fragment ${ref}`);
      }
    }
  });
}

test('download page clearly explains that public builds are not yet available', () => {
  const html = readFileSync(resolve(root, 'download.html'), 'utf8');
  assert.match(html, /No public download is available yet/);
  assert.match(html, /href="https:\/\/github.com\/KyleMyers001\/voxloom\/releases"/);
  assert.doesNotMatch(html, /href="[^"]+\.dmg"|releases\/latest|Gatekeeper steps/);
});

test('build publishes only the website, never local tokens, docs or scripts', () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const expected = [
    ...pages, 'base.css', 'home.css', 'favicon.ico', 'favicon.svg',
    'apple-touch-icon.png', 'assets/og.png',
  ].sort();
  const actual = readdirSync(resolve(root, 'public'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name).slice(resolve(root, 'public').length + 1))
    .sort();
  assert.deepEqual(actual, expected);
  for (const file of expected) {
    assert.deepEqual(readFileSync(resolve(root, 'public', file)), readFileSync(resolve(root, file)));
  }
});

test('favicon retains the app brand colors after migration', () => {
  const svg = readFileSync(resolve(root, 'favicon.svg'), 'utf8');
  for (const color of ['#3cf0ff', '#b6ff3c']) assert.ok(svg.includes(color));
  for (const color of ['#4cf4ff', '#c4ff5a']) assert.ok(!svg.includes(color));
});
