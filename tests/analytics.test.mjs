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

const read = (dir, page) => readFileSync(resolve(dir, page), 'utf8');

function build(envExtra = {}) {
  const out = mkdtempSync(join(tmpdir(), 'voxloom-site-build-'));
  const env = { ...process.env, ...envExtra, BUILD_OUTPUT: out };
  if (!('CF_ANALYTICS_TOKEN' in envExtra)) delete env.CF_ANALYTICS_TOKEN;
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8', env });
  return { result, out };
}

test('privacy page states that the website uses cookieless Cloudflare Web Analytics', () => {
  const html = read(root, 'privacy.html');
  assert.match(html, /id="site-analytics-h"/);
  assert.match(html, /The Voxloom website uses Cloudflare Web Analytics for aggregate page views/);
  assert.match(html, /uses no cookies and does not collect or use visitors. personal data/);
  assert.match(html, /The Voxloom app itself does not include this beacon and sends nothing to this service/);
});

test('source pages never ship an analytics beacon or a site token', () => {
  for (const page of pages) {
    const html = read(root, page);
    assert.doesNotMatch(html, /cloudflareinsights|data-cf-beacon|CF_ANALYTICS_TOKEN/);
  }
});

test('build without CF_ANALYTICS_TOKEN emits no analytics tag', () => {
  const { result, out } = build();
  try {
    assert.equal(result.status, 0, result.stderr);
    for (const page of pages) {
      const html = read(out, page);
      assert.doesNotMatch(html, /cloudflareinsights|data-cf-beacon|beacon\.min\.js/);
      assert.equal(html, read(root, page));
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build with a hex token injects the official beacon on every page', () => {
  const { result, out } = build({ CF_ANALYTICS_TOKEN: dummy });
  try {
    assert.equal(result.status, 0, result.stderr);
    const snippet = `<script type="module" src="${beaconHost}" data-cf-beacon='{"token": "${dummy}"}'></script>`;
    for (const page of pages) {
      const html = read(out, page);
      assert.ok(html.includes(snippet), `${page} is missing the injected beacon`);
      assert.equal(html.split(beaconHost).length - 1, 1);
      assert.ok(html.includes(`${snippet}\n</body>`), `${page} does not place the beacon before </body>`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build rejects a non-hex token and writes no beacon', () => {
  const { result, out } = build({ CF_ANALYTICS_TOKEN: 'not-a-token"><script>' });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hex site token/);
    for (const page of readdirSync(out).filter((name) => name.endsWith('.html'))) {
      assert.doesNotMatch(read(out, page), /cloudflareinsights|data-cf-beacon|not-a-token/);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
