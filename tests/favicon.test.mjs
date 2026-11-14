import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash as sha256 } from 'node:crypto';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['index.html', 'download.html', 'privacy.html', 'changelog.html'];

// Byte-identical to voxloom-site #8 (e58eb13 / PR #10 tree c7dc05d).
const FAVICON_SVG_SHA256 =
  'd7cbf5bb0dabf577f5faf484bd896e0b407b7b42b573bd4632a921d94340cb52';
const FAVICON_ICO_SHA256 =
  '63ab5b798ad60428ef9533ad3a43cfe16c529aaa81670d787864dd0544f1a371';

const CORNER_TOP = [0x2a, 0x2a, 0x38];
const CORNER_BOTTOM = [0x0a, 0x0a, 0x10];

function digest(rel) {
  return sha256('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
}

function readPng(rel) {
  const buf = readFileSync(resolve(root, rel));
  assert.deepEqual(
    buf.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    `${rel} is not a PNG`,
  );
  let offset = 8;
  let ihdr;
  const idats = [];
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idats.push(data);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  assert.ok(ihdr, `${rel} is missing IHDR`);
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  assert.equal(bitDepth, 8, `${rel} must be 8-bit`);
  // 2 = truecolour (opaque), 6 = truecolour + alpha
  assert.ok(colorType === 2 || colorType === 6, `${rel} unexpected color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idats));
  const channels = colorType === 6 ? 4 : 3;
  const stride = 1 + width * channels;
  assert.equal(raw.length, stride * height, `${rel} unexpected decompressed size`);
  const pixels = Buffer.alloc(width * height * channels);
  const prev = Buffer.alloc(width * channels);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride];
    const row = raw.subarray(y * stride + 1, y * stride + stride);
    const out = pixels.subarray(y * width * channels, (y + 1) * width * channels);
    for (let i = 0; i < row.length; i += 1) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`${rel} unsupported PNG filter ${filter}`);
      }
      out[i] = (row[i] + pred) & 0xff;
    }
    out.copy(prev);
  }
  return { width, height, colorType, channels, pixels };
}

function pixelAt(png, x, y) {
  const i = (y * png.width + x) * png.channels;
  return Array.from(png.pixels.subarray(i, i + png.channels));
}

function closeRgb(actual, expected, tol = 2) {
  assert.ok(
    expected.every((value, i) => Math.abs(actual[i] - value) <= tol),
    `expected ~${expected} got ${actual.slice(0, 3)}`,
  );
}

test('favicon.svg is byte-identical to the #8 asset', () => {
  assert.equal(digest('favicon.svg'), FAVICON_SVG_SHA256);
});

test('favicon.ico is byte-identical to the #8 asset', () => {
  assert.equal(digest('favicon.ico'), FAVICON_ICO_SHA256);
});

test('icon-192.png and icon-512.png are opaque full-bleed tiles', () => {
  for (const [rel, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
    const png = readPng(rel);
    assert.equal(png.width, size);
    assert.equal(png.height, size);
    if (png.colorType === 6) {
      for (let i = 3; i < png.pixels.length; i += 4) {
        assert.equal(png.pixels[i], 255, `${rel} has a transparent pixel`);
      }
    }
    closeRgb(pixelAt(png, 0, 0), CORNER_TOP);
    closeRgb(pixelAt(png, size - 1, 0), CORNER_TOP);
    closeRgb(pixelAt(png, 0, size - 1), CORNER_BOTTOM);
    closeRgb(pixelAt(png, size - 1, size - 1), CORNER_BOTTOM);
  }
});

test('manifest.webmanifest is valid and its icon files exist', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), [
    'background_color',
    'icons',
    'name',
    'short_name',
    'theme_color',
  ]);
  assert.equal(manifest.name, 'Voxloom');
  assert.equal(manifest.short_name, 'Voxloom');
  assert.equal(manifest.theme_color, '#07070b');
  assert.equal(manifest.background_color, '#07070b');
  assert.equal(manifest.icons.length, 2);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    const file = resolve(root, icon.src);
    const png = readPng(icon.src);
    assert.equal(`${png.width}x${png.height}`, icon.sizes);
    assert.ok(readFileSync(file).length > 0);
  }
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ['192x192', '512x512'],
  );
});

test('every page links the manifest and keeps the #8 icon markup plus the 192 PNG', () => {
  for (const page of pages) {
    const html = readFileSync(resolve(root, page), 'utf8');
    assert.ok(html.includes('<link rel="manifest" href="manifest.webmanifest">'), `${page} missing manifest link`);
    assert.ok(html.includes('<link rel="icon" href="favicon.ico" sizes="any">'), `${page} missing ICO link`);
    assert.ok(html.includes('<link rel="icon" href="favicon.svg" type="image/svg+xml">'), `${page} missing SVG link`);
    assert.ok(
      html.includes('<link rel="icon" href="icon-192.png" type="image/png" sizes="192x192">'),
      `${page} missing 192 PNG link`,
    );
    assert.ok(html.includes('<link rel="apple-touch-icon" href="apple-touch-icon.png">'), `${page} missing apple-touch`);
    // 512 stays manifest-only so desktop tabs never see it as rel=icon.
    assert.ok(!html.includes('icon-512.png'), `${page} must not link icon-512.png`);
  }
});
