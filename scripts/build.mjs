import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'public');
const files = [
  'index.html', 'download.html', 'privacy.html', 'changelog.html',
  'base.css', 'home.css', 'favicon.ico', 'favicon.svg',
  'apple-touch-icon.png', 'assets/og.png',
];

await rm(output, { recursive: true, force: true });
for (const file of files) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, file), destination);
}
console.log(`Built ${files.length} static files in public/.`);
