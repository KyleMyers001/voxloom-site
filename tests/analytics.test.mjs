import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite, files as siteFiles, cardMark, dateBefore } from '../scripts/site-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['index.html', 'download.html', 'privacy.html', 'changelog.html'];
const beaconHost = 'https://static.cloudflareinsights.com/beacon.min.js';
const dummy = '0123456789abcdef0123456789abcdef';
const cardText = 'The Voxloom website uses Cloudflare Web Analytics for aggregate page views';

const read = (dir, page) => readFileSync(resolve(dir, page), 'utf8');

function build(envExtra = {}) {
  const out = mkdtempSync(join(tmpdir(), 'voxloom-site-build-'));
  const env = { ...process.env, ...envExtra, BUILD_OUTPUT: out };
  if (!('CF_ANALYTICS_TOKEN' in envExtra)) delete env.CF_ANALYTICS_TOKEN;
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8', env });
  return { result, out };
}

function makeFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'voxloom-src-'));
  const out = mkdtempSync(join(tmpdir(), 'voxloom-out-'));
  for (const file of siteFiles) {
    const dest = resolve(dir, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolve(root, file), dest);
  }
  writeFileSync(resolve(out, 'SENTINEL'), 'keep');
  mutate?.(dir);
  return { dir, out };
}

function outputListing(out) {
  return readdirSync(out).sort();
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

test('build accepts a 32-hex token with surrounding whitespace after trim', async () => {
  const { dir, out } = makeFixture();
  try {
    await buildSite({ root: dir, output: out, token: `  ${dummy}\n` });
    assert.ok(read(out, 'privacy.html').includes(cardText));
    assert.ok(read(out, 'index.html').includes(`{"token": "${dummy}"}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('build rejects non-32-hex tokens and leaves the output directory untouched', async () => {
  const cases = [
    'not-a-token"><script>',
    dummy.slice(0, 31),
    `${dummy}0`,
    'abc',
    '   \n',
  ];
  for (const value of cases) {
    const { dir, out } = makeFixture();
    try {
      await assert.rejects(() => buildSite({ root: dir, output: out, token: value }), /32-character hex/);
      assert.deepEqual(outputListing(out), ['SENTINEL']);
      assert.equal(read(out, 'SENTINEL'), 'keep');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  }
});

test('build with a token throws if the last-updated date is missing and leaves output untouched', async () => {
  const { dir, out } = makeFixture((src) => {
    const path = resolve(src, 'privacy.html');
    writeFileSync(path, read(src, 'privacy.html').replace(dateBefore, 'Last updated: January 1, 2020.'));
  });
  try {
    await assert.rejects(() => buildSite({ root: dir, output: out, token: dummy }), /November 4, 2026/);
    assert.deepEqual(outputListing(out), ['SENTINEL']);
    assert.equal(read(out, 'SENTINEL'), 'keep');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('marker replacement is checked and works without a trailing newline', async () => {
  const { dir, out } = makeFixture((src) => {
    const path = resolve(src, 'privacy.html');
    writeFileSync(path, read(src, 'privacy.html').replace(`${cardMark}\n`, cardMark));
  });
  try {
    await buildSite({ root: dir, output: out, token: dummy });
    const privacy = read(out, 'privacy.html');
    assert.ok(privacy.includes(cardText));
    assert.doesNotMatch(privacy, /voxloom-analytics-card/);
    assert.match(privacy, /Last updated: November 10, 2026/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('a missing analytics marker fails before writing output', async () => {
  const { dir, out } = makeFixture((src) => {
    const path = resolve(src, 'privacy.html');
    writeFileSync(path, read(src, 'privacy.html').replace(`${cardMark}\n`, ''));
  });
  try {
    await assert.rejects(() => buildSite({ root: dir, output: out, token: dummy }), /missing the <!--voxloom-analytics-card--> marker/);
    assert.deepEqual(outputListing(out), ['SENTINEL']);
    assert.equal(read(out, 'SENTINEL'), 'keep');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('a missing </body> tag fails before writing output', async () => {
  const { dir, out } = makeFixture((src) => {
    const path = resolve(src, 'index.html');
    writeFileSync(path, read(src, 'index.html').replace('</body>', '</div>'));
  });
  try {
    await assert.rejects(() => buildSite({ root: dir, output: out, token: dummy }), /index\.html is missing a closing body tag/);
    assert.deepEqual(outputListing(out), ['SENTINEL']);
    assert.equal(read(out, 'SENTINEL'), 'keep');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
