import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './site-build.mjs';

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

await buildSite({
  root,
  output: outputDir(),
  token: process.env.CF_ANALYTICS_TOKEN,
});
