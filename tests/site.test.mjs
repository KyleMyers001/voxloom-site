import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://voxloom.app';
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
const dmg = `${repo}/releases/download/v0.4.0/Voxloom_0.4.0_macos_universal.dmg`;
const sums = `${repo}/releases/download/v0.4.0/SHA256SUMS`;
const read = (page) => readFileSync(resolve(root, page), 'utf8');

test('download page is ready for v0.4.0 assets and install steps', () => {
  const html = read('download.html');
  for (const url of [dmg, sums, `${repo}/releases/download/v0.4.0/Voxloom_0.4.0_macos_universal.app.zip`, `${repo}/releases/tag/v0.4.0`, `${repo}/releases`, `${repo}/issues`]) {
    assert.ok(html.includes(`href="${url}"`), `missing ${url}`);
  }
  assert.match(html, /class="badge beta">Beta</);
  assert.match(html, /Work in progress/);
  assert.match(html, /Download v0\.4\.0 \(\.dmg\)/);
  assert.match(html, /<code>Voxloom_0\.4\.0_macos_universal\.dmg<\/code>/);
  assert.match(html, /macOS 13\.1 \(Ventura\) or later/);
  assert.match(html, /drag <b>Voxloom<\/b> to Applications/);
  assert.match(html, /Privacy &amp; Security → Microphone/);
  assert.match(html, /Privacy &amp; Security → Accessibility/);
  assert.match(html, /Privacy &amp; Security → Input Monitoring/);
  assert.match(html, /record the key again/);
});

test('homepage download buttons and beta label use v0.4.0', () => {
  const html = read('index.html');
  assert.equal(html.split(`href="${dmg}"`).length - 1, 2);
  assert.equal(html.split('Download v0.4.0 for macOS').length - 1, 2);
  assert.match(html, /Beta v0\.4\.0/);
  assert.match(html, /class="badge beta">Beta</);
  assert.match(html, /expect rough edges/);
  assert.ok(html.includes(`href="${repo}/issues"`));
});

test('homepage presents the launch features without an upcoming-release teaser', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /next-h|In development|Next up/);
  assert.match(html, /dictionary[\s\S]*case[\s\S]*spacing/i);
  assert.ok(html.includes('href="changelog.html#v040-h"'));
  assert.match(html, /Local cleanup[\s\S]*[Ee]xperimental/);
  assert.match(html, /optional[\s\S]*punctuation[\s\S]*filler words/i);
  assert.match(html, /depending on your retention setting/);
  assert.doesNotMatch(html, /Nothing lost\.|Every result saved/);
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

test('install guide describes the v0.3 in-app cleanup download, not manual Import', () => {
  const html = read('download.html');
  const cleanup = html.match(/<section[^>]+aria-labelledby="cleanup-h"[\s\S]*?<\/section>/)?.[0];
  assert.ok(cleanup, 'missing optional cleanup setup');
  assert.match(cleanup, /[Ee]xperimental/);
  assert.match(cleanup, /Qwen3 0\.6B/);
  assert.match(cleanup, /Q4_K_M/);
  assert.match(cleanup, /397 MB/);
  assert.match(cleanup, /Download \(397 MB\)/);
  assert.match(cleanup, /Cancel/);
  assert.doesNotMatch(cleanup, /Import model|v0\.2|upcoming|in development/i);
  assert.match(cleanup, /Clean up transcripts locally/);
  assert.match(cleanup, /not required for dictation/);
});

test('v0.4 release notes cover merged changes and sit above v0.3', () => {
  const html = read('changelog.html');
  const launch = html.match(/<section[^>]+aria-labelledby="v040-h"[\s\S]*?<\/section>/)?.[0];
  assert.ok(launch, 'missing v0.4 release notes');
  assert.match(launch, /Voxloom v0\.4\.0/);
  for (const number of [155, 156, 157, 160, 165]) {
    assert.ok(launch.includes(`href="${repo}/pull/${number}"`), `missing #${number}`);
  }
  assert.match(launch, /2026-11-07 · BETA/);
  for (const url of [dmg, sums, `${repo}/releases/tag/v0.4.0`, `${repo}/compare/v0.3.0...v0.4.0`]) {
    assert.ok(launch.includes(`href="${url}"`), `missing ${url}`);
  }
  assert.ok(html.indexOf('id="v040-h"') < html.indexOf('id="v030-h"'));
  for (const page of ['index.html', 'download.html']) {
    assert.doesNotMatch(read(page), /v0\.3\.0|Voxloom_0\.3/, page);
  }
});

test('v0.3 launch notes cover merged changes and preserve historical v0.2 downloads', () => {
  const html = read('changelog.html');
  const launch = html.match(/<section[^>]+aria-labelledby="v030-h"[\s\S]*?<\/section>/)?.[0];
  assert.ok(launch, 'missing v0.3 release notes');
  assert.match(launch, /Voxloom v0\.3\.0/);
  for (const number of [148, 149, 151, 152, 154]) {
    assert.ok(launch.includes(`href="${repo}/pull/${number}"`), `missing #${number}`);
  }
  assert.doesNotMatch(launch, /UNRELEASED|IN DEVELOPMENT|What&rsquo;s coming|\/pull\/155"/);
  assert.match(launch, /2026-11-04 · BETA/);
  assert.match(launch, /signed with a Developer ID and notarized by Apple/);
  assert.match(read('download.html'), /signed with a Developer ID and notarized by Apple/);
  for (const url of [`${repo}/releases/download/v0.3.0/Voxloom_0.3.0_macos_universal.dmg`, `${repo}/releases/download/v0.3.0/SHA256SUMS`, `${repo}/releases/tag/v0.3.0`, `${repo}/compare/v0.2.0...v0.3.0`]) {
    assert.ok(launch.includes(`href="${url}"`), `missing ${url}`);
  }
  assert.ok(html.indexOf('id="v030-h"') < html.indexOf('id="v020-h"'));
  assert.ok(html.includes(`href="${repo}/releases/download/v0.2.0/Voxloom_0.2.0_macos_universal.dmg"`));
  assert.ok(html.includes(`href="${repo}/releases/download/v0.2.0/SHA256SUMS"`));
  for (const page of ['index.html', 'download.html', 'privacy.html']) {
    assert.doesNotMatch(read(page), /v0\.2|Voxloom_0\.2|upcoming|in development|next up/i, page);
  }
});

test('privacy covers both local models, plain-text history and temporary clipboard use', () => {
  const html = read('privacy.html');
  assert.doesNotMatch(html, /the only download is a Whisper model|The one download: models/);
  assert.match(html, /Qwen3 0\.6B/);
  assert.match(html, /unsloth\/Qwen3-0\.6B-GGUF/);
  assert.match(html, /SHA-256/);
  assert.doesNotMatch(html, /upcoming|import it/i);
  assert.match(html, /raw and final transcript/);
  assert.match(html, /unencrypted/);
  assert.match(html, /retention never deletes/);
  assert.match(html, /clipboard managers/);
  assert.ok(html.includes(`href="${repo}/blob/main/PRIVACY.md"`));
  for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    assert.ok(html.includes(`<meta ${tag} content="How Voxloom handles your data: transcription and optional cleanup run on your Mac, model downloads are user-started, and history stays local.">`));
  }
});

test('no stale pre-release copy remains', () => {
  for (const page of pages) {
    assert.doesNotMatch(read(page), /coming soon|without extra steps|No public (download|release)|not yet available|Once a public build|first signed release/i, page);
  }
});

test('build publishes only the website, never local tokens, docs or scripts', () => {
  const env = { ...process.env };
  delete env.CF_ANALYTICS_TOKEN;
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8', env });
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

test('no file still points at the old Vercel subdomain', () => {
  const skip = new Set(['.git', 'node_modules', 'public']);
  const old = ['voxloom', 'vercel', 'app'].join('.');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.has(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  for (const file of walk(root)) {
    if (!/\.(html|css|mjs|js|json|md|sh|txt|xml)$/.test(file)) continue;
    assert.ok(!readFileSync(file, 'utf8').includes(old), `${file} still mentions the old domain`);
  }
});
