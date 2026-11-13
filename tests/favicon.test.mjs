import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function parseIcoPngs(buf) {
  const count = buf.readUInt16LE(4);
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const width = buf[entry] === 0 ? 256 : buf[entry];
    const height = buf[entry + 1] === 0 ? 256 : buf[entry + 1];
    const size = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    frames.push({ width, height, png: buf.subarray(offset, offset + size) });
  }
  return frames;
}

function paethPredictor(left, up, upLeft) {
  const start = left + up - upLeft;
  const pa = Math.abs(start - left);
  const pb = Math.abs(start - up);
  const pc = Math.abs(start - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function unfilter(filter, row, prev, out, bpp) {
  for (let x = 0; x < row.length; x += 1) {
    const left = x >= bpp ? out[x - bpp] : 0;
    const up = prev[x];
    const upLeft = x >= bpp ? prev[x - bpp] : 0;
    if (filter === 0) out[x] = row[x];
    else if (filter === 1) out[x] = (row[x] + left) & 255;
    else if (filter === 2) out[x] = (row[x] + up) & 255;
    else if (filter === 3) out[x] = (row[x] + ((left + up) >> 1)) & 255;
    else if (filter === 4) out[x] = (row[x] + paethPredictor(left, up, upLeft)) & 255;
    else throw new Error(`unsupported PNG filter ${filter}`);
  }
}

function decodeRgbaPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const parts = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, 'ICO frames must be 8-bit RGBA PNGs');
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    unfilter(filter, row, prev, out, 4);
    prev = Buffer.from(out);
  }
  return { width, height, pixels };
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [...image.pixels.subarray(i, i + 4)];
}

test('favicon.svg paints an opaque background behind the rounded tile', () => {
  const svg = readFileSync(resolve(root, 'favicon.svg'), 'utf8');
  for (const color of ['#3cf0ff', '#b6ff3c', '#2a2a38', '#0a0a10']) {
    assert.ok(svg.includes(color), `missing ${color}`);
  }
  assert.match(svg, /viewBox="72 72 880 880"/);
  const backdrop = /<rect x="72" y="72" width="880" height="880" fill="url\(#bg\)"\/>/;
  const tile = /<rect x="72" y="72" width="880" height="880" rx="200" fill="url\(#bg\)"\/>/;
  assert.match(svg, backdrop);
  assert.match(svg, tile);
  assert.ok(svg.search(backdrop) < svg.search(tile), 'opaque backdrop must sit behind the rounded tile');
});

test('favicon.ico 16/32/48 frames are fully opaque with gradient corners', () => {
  const buf = readFileSync(resolve(root, 'favicon.ico'));
  const frames = parseIcoPngs(buf);
  const sizes = frames.map((frame) => frame.width).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48]);
  for (const frame of frames) {
    const image = decodeRgbaPng(frame.png);
    assert.equal(image.width, frame.width);
    assert.equal(image.height, frame.height);
    for (let i = 3; i < image.pixels.length; i += 4) {
      assert.equal(image.pixels[i], 255, `${frame.width}px ICO has a transparent pixel`);
    }
    const max = frame.width - 1;
    const top = [pixel(image, 0, 0), pixel(image, max, 0)];
    const bottom = [pixel(image, 0, max), pixel(image, max, max)];
    for (const [r, g, b] of top) {
      assert.ok(Math.abs(r - 0x2a) <= 3 && Math.abs(g - 0x2a) <= 3 && Math.abs(b - 0x38) <= 3,
        `${frame.width}px top corner ${[r, g, b]} should be near #2a2a38`);
    }
    for (const [r, g, b] of bottom) {
      assert.ok(Math.abs(r - 0x0a) <= 3 && Math.abs(g - 0x0a) <= 3 && Math.abs(b - 0x10) <= 3,
        `${frame.width}px bottom corner ${[r, g, b]} should be near #0a0a10`);
    }
  }
});
