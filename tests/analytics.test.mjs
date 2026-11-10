import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildSite, files as siteFiles, pages, cardMark, dateBefore, analyticsSnippet,
  expectedDisabledBytes,
} from '../scripts/site-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cardText = 'The Voxloom website uses Vercel Web Analytics for aggregate page-view reports';
const scriptSrc = '/_vercel/insights/script.js';

const read = (dir, page) => readFileSync(resolve(dir, page), 'utf8');

function build(envExtra = {}) {
  const out = mkdtempSync(join(tmpdir(), 'voxloom-site-build-'));
  const env = { ...process.env, ...envExtra, BUILD_OUTPUT: out };
  if (!('VOXLOOM_ANALYTICS' in envExtra)) delete env.VOXLOOM_ANALYTICS;
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

const listing = (out) => readdirSync(out).sort();

test('source privacy.html keeps the card behind a build marker and does not ship the claim', () => {
  const html = read(root, 'privacy.html');
  assert.ok(html.includes(cardMark));
  assert.doesNotMatch(html, /Vercel Web Analytics|site-analytics-h|This website, not the app/);
  assert.doesNotMatch(html, /PLACEHOLDER/);
  for (const page of pages) {
    assert.doesNotMatch(read(root, page), /_vercel\/insights|window\.va|VOXLOOM_ANALYTICS/);
  }
});

test('disabled build matches source, with only the analytics marker stripped from privacy.html', () => {
  const { result, out } = build();
  try {
    assert.equal(result.status, 0, result.stderr);
    for (const file of siteFiles) {
      const built = readFileSync(resolve(out, file));
      assert.deepEqual(built, expectedDisabledBytes(root, file), `${file} is not byte-identical to the disabled source`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('enabled build injects one script plus stub per page and the privacy card', () => {
  const { result, out } = build({ VOXLOOM_ANALYTICS: '1' });
  try {
    assert.equal(result.status, 0, result.stderr);
    for (const page of pages) {
      const html = read(out, page);
      assert.equal(html.split(analyticsSnippet).length - 1, 1, `${page} should contain the snippet once`);
      assert.equal(html.split(scriptSrc).length - 1, 1);
      assert.equal(html.split('window.va = window.va').length - 1, 1);
      assert.ok(html.includes(`${analyticsSnippet}</body>`), `${page} does not place the snippet before </body>`);
      assert.doesNotMatch(html, /voxloom-analytics-card/);
    }
    const privacy = read(out, 'privacy.html');
    assert.ok(privacy.includes(cardText));
    assert.match(privacy, /id="site-analytics-h"/);
    assert.match(privacy, /This website, not the app/);
    assert.match(privacy, /does not use cookies/);
    assert.match(privacy, /hash created from the incoming request/);
    assert.match(privacy, /automatically discarded after 24 hours/);
    assert.match(privacy, /pages visited, referrer, approximate location, and browser, OS, and device type/);
    assert.doesNotMatch(privacy, /only stores anonymized, aggregated data/);
    assert.match(privacy, /The Voxloom app itself does not include this analytics script and sends nothing to this service/);
    assert.match(privacy, /Last updated: November 10, 2026/);
    assert.doesNotMatch(privacy, /November 4, 2026/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('invalid VOXLOOM_ANALYTICS values fail before writing output', async () => {
  for (const value of ['0', 'true', 'yes', '1\n', ' 1', '2']) {
    const { dir, out } = makeFixture();
    try {
      await assert.rejects(
        () => buildSite({ root: dir, output: out, flag: value }),
        /exactly '1'/,
      );
      assert.deepEqual(listing(out), ['SENTINEL']);
      assert.equal(read(out, 'SENTINEL'), 'keep');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  }
});

test('build with the flag throws if the last-updated date is missing and leaves output untouched', async () => {
  const { dir, out } = makeFixture((src) => {
    writeFileSync(resolve(src, 'privacy.html'), read(src, 'privacy.html').replace(dateBefore, 'Last updated: January 1, 2020.'));
  });
  try {
    await assert.rejects(() => buildSite({ root: dir, output: out, flag: '1' }), /November 4, 2026/);
    assert.deepEqual(listing(out), ['SENTINEL']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('marker replacement is checked, consumes leading indentation, and works without a trailing newline', async () => {
  const { dir, out } = makeFixture((src) => {
    writeFileSync(resolve(src, 'privacy.html'), read(src, 'privacy.html').replace(`  ${cardMark}\n`, `  ${cardMark}`));
  });
  try {
    await buildSite({ root: dir, output: out, flag: '1' });
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
    writeFileSync(resolve(src, 'privacy.html'), read(src, 'privacy.html').replace(`  ${cardMark}\n`, ''));
  });
  try {
    await assert.rejects(
      () => buildSite({ root: dir, output: out, flag: '1' }),
      /missing the <!--voxloom-analytics-card--> marker/,
    );
    assert.deepEqual(listing(out), ['SENTINEL']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('a missing </body> tag fails before writing output', async () => {
  const { dir, out } = makeFixture((src) => {
    writeFileSync(resolve(src, 'index.html'), read(src, 'index.html').replace('</body>', '</div>'));
  });
  try {
    await assert.rejects(
      () => buildSite({ root: dir, output: out, flag: '1' }),
      /index\.html is missing a closing body tag/,
    );
    assert.deepEqual(listing(out), ['SENTINEL']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('no file in the repo mentions the previous analytics vendor', () => {
  const skip = new Set(['.git', 'node_modules', 'public']);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.has(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  for (const file of walk(root)) {
    if (!/\.(html|css|mjs|js|json|md|sh|txt|xml)$/.test(file)) continue;
    const banned = ['cloud', 'flare'].join('');
    assert.ok(!readFileSync(file, 'utf8').toLowerCase().includes(banned), file);
  }
});

