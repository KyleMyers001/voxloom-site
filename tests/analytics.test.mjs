import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['index.html', 'download.html', 'privacy.html', 'changelog.html'];
const beaconHost = 'https://static.cloudflareinsights.com/beacon.min.js';
const dummy = '0123456789abcdef0123456789abcdef';
const cardMark = '<!--voxloom-analytics-card-->';
const cardText = 'The Voxloom website uses Cloudflare Web Analytics for aggregate page views';

const read = (dir, page) => readFileSync(resolve(dir, page), 'utf8');

function build(envExtra = {}) {
  const out = mkdtempSync(join(tmpdir(), 'voxloom-site-build-'));
  const env = { ...process.env, ...envExtra, BUILD_OUTPUT: out };
  if (!('CF_ANALYTICS_TOKEN' in envExtra)) delete env.CF_ANALYTICS_TOKEN;
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8', env });
  return { result, out };
}

test('source privacy.html keeps the card behind a build marker and does not ship the claim', () => {
  const html = read(root, 'privacy.html');
  assert.ok(html.includes(cardMark));
  assert.doesNotMatch(html, /Cloudflare Web Analytics|site-analytics-h|This website, not the app/);
  assert.doesNotMatch(html, /PLACEHOLDER/);
  for (const page of pages) {
    assert.doesNotMatch(read(root, page), /cloudflareinsights|data-cf-beacon|CF_ANALYTICS_TOKEN/);
  }
});

test('build without CF_ANALYTICS_TOKEN emits no card, marker or beacon', () => {
  const { result, out } = build();
  try {
    assert.equal(result.status, 0, result.stderr);
    for (const page of pages) {
      const html = read(out, page);
      assert.doesNotMatch(html, /cloudflareinsights|data-cf-beacon|beacon\.min\.js|voxloom-analytics-card/);
      if (page === 'privacy.html') {
        assert.doesNotMatch(html, /Cloudflare Web Analytics|site-analytics-h|This website, not the app/);
        assert.match(html, /Last updated: November 4, 2026/);
        assert.doesNotMatch(html, /November 10, 2026/);
      } else {
        assert.equal(html, read(root, page));
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build with a hex token injects the privacy card and the official beacon on every page', () => {
  const { result, out } = build({ CF_ANALYTICS_TOKEN: dummy });
  try {
    assert.equal(result.status, 0, result.stderr);
    const snippet = `<script type="module" src="${beaconHost}" data-cf-beacon='{"token": "${dummy}"}'></script>`;
    for (const page of pages) {
      const html = read(out, page);
      assert.ok(html.includes(snippet), `${page} is missing the injected beacon`);
      assert.equal(html.split(beaconHost).length - 1, 1);
      assert.ok(html.includes(`${snippet}\n</body>`), `${page} does not place the beacon before </body>`);
      assert.doesNotMatch(html, /voxloom-analytics-card/);
    }
    const privacy = read(out, 'privacy.html');
    assert.ok(privacy.includes(cardText));
    assert.match(privacy, /id="site-analytics-h"/);
    assert.match(privacy, /This website, not the app/);
    assert.match(privacy, /uses no cookies and does not collect or use visitors. personal data/);
    assert.match(privacy, /The Voxloom app itself does not include this beacon and sends nothing to this service/);
    assert.match(privacy, /Last updated: November 10, 2026/);
    assert.doesNotMatch(privacy, /November 4, 2026/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build rejects a non-hex token and writes no beacon', () => {
  const { result, out } = build({ CF_ANALYTICS_TOKEN: 'not-a-token"><script>' });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hex site token/);
    const htmlFiles = exists(out) ? readdirSync(out).filter((name) => name.endsWith('.html')) : [];
    for (const page of htmlFiles) {
      assert.doesNotMatch(read(out, page), /cloudflareinsights|data-cf-beacon|not-a-token|Cloudflare Web Analytics/);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

function exists(dir) {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
