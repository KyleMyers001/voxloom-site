import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://voxloom.vercel.app';
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

const repo = 'https://github.com/KyleMyers001/voxloom';
const dmg = `${repo}/releases/download/v0.2.0/Voxloom_0.2.0_macos_universal.dmg`;
const sums = `${repo}/releases/download/v0.2.0/SHA256SUMS`;
const read = (page) => readFileSync(resolve(root, page), 'utf8');

test('download page links the v0.2.0 release assets and install steps', () => {
  const html = read('download.html');
  for (const url of [dmg, sums, `${repo}/releases/download/v0.2.0/Voxloom_0.2.0_macos_universal.app.zip`, `${repo}/releases`, `${repo}/issues`]) {
    assert.ok(html.includes(`href="${url}"`), `missing ${url}`);
  }
  assert.match(html, /class="badge beta">Beta</);
  assert.match(html, /Work in progress/);
  assert.match(html, /signed with a Developer ID and notarized by Apple/);
  assert.match(html, /macOS 13\.1 \(Ventura\) or later/);
  assert.match(html, /drag <b>Voxloom<\/b> to Applications/);
  assert.match(html, /Privacy &amp; Security → Microphone/);
  assert.match(html, /Privacy &amp; Security → Accessibility/);
  assert.match(html, /Privacy &amp; Security → Input Monitoring/);
  assert.match(html, /record the key again/);
});

test('homepage download buttons use the v0.2.0 DMG and show the beta status', () => {
  const html = read('index.html');
  assert.equal(html.split(`href="${dmg}"`).length - 1, 2);
  assert.match(html, /class="badge beta">Beta</);
  assert.match(html, /expect rough edges/);
  assert.ok(html.includes(`href="${repo}/issues"`));
});

test('changelog carries the v0.2.0 release notes', () => {
  const html = read('changelog.html');
  assert.match(html, /Voxloom v0\.2\.0/);
  assert.ok(html.includes(`href="${repo}/pull/147"`));
  assert.ok(html.includes(`href="${repo}/releases/tag/v0.2.0"`));
  assert.doesNotMatch(html, /Edit before publishing/);
  assert.doesNotMatch(html, /BUS-\d+/);
  assert.doesNotMatch(html, /fix L4|\(not wired\)/i);
  assert.doesNotMatch(html, /<li>\s*(ci|test)\(/i);
});

test('no stale pre-release copy remains', () => {
  for (const page of pages) {
    assert.doesNotMatch(read(page), /coming soon|without extra steps|No public (download|release)|not yet available|Once a public build|first signed release/i, page);
  }
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
