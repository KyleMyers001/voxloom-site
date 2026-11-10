import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function outputDir() {
  const raw = process.env.BUILD_OUTPUT;
  if (!raw) return resolve(root, 'public');
  const dest = resolve(root, raw);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (dest !== resolve(root, 'public') && !dest.startsWith(prefix) && !dest.startsWith('/tmp/')) {
    throw new Error('BUILD_OUTPUT must be public/, a path under the repo, or a /tmp directory.');
  }
  return dest;
}

const output = outputDir();
const pages = ['index.html', 'download.html', 'privacy.html', 'changelog.html'];
const files = [
  ...pages, 'base.css', 'home.css', 'favicon.ico', 'favicon.svg',
  'apple-touch-icon.png', 'assets/og.png',
];

const token = process.env.CF_ANALYTICS_TOKEN ?? '';

function analyticsSnippet(value) {
  if (!/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error('CF_ANALYTICS_TOKEN must be a hex site token from Cloudflare Web Analytics.');
  }
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${escaped}"}'></script>\n`;
}

await rm(output, { recursive: true, force: true });
for (const file of files) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, file), destination);
}

if (token) {
  const snippet = analyticsSnippet(token);
  for (const page of pages) {
    const path = resolve(output, page);
    const html = await readFile(path, 'utf8');
    if (!html.includes('</body>')) {
      throw new Error(`${page} is missing a closing body tag; cannot inject analytics.`);
    }
    await writeFile(path, html.replace('</body>', `${snippet}</body>`));
  }
}

console.log(`Built ${files.length} static files in public/.`);
