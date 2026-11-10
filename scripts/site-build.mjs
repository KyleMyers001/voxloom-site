import { copyFile, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const pages = ['index.html', 'download.html', 'privacy.html', 'changelog.html'];
export const files = [
  ...pages, 'base.css', 'home.css', 'favicon.ico', 'favicon.svg',
  'apple-touch-icon.png', 'assets/og.png',
];
export const cardMark = '<!--voxloom-analytics-card-->';
export const dateBefore = 'Last updated: November 4, 2026.';
export const dateAfter = 'Last updated: November 10, 2026.';
export const cardMarkPattern = /^[ \t]*<!--voxloom-analytics-card-->\n?/m;

const analyticsCard = `  <section class="card" aria-labelledby="site-analytics-h"><small>WEBSITE</small><h2 class="h3" id="site-analytics-h">This website, not the app</h2>
    <p>The Voxloom website uses Vercel Web Analytics for aggregate page views. Vercel's documentation says it does not use cookies and only stores anonymized, aggregated data. The Voxloom app itself does not include this analytics script and sends nothing to this service.</p>
  </section>
`;

export const analyticsSnippet = `<script>
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>
`;

export function resolveAnalyticsFlag(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === '1') return true;
  throw new Error("VOXLOOM_ANALYTICS must be exactly '1' to enable, or unset or empty to disable.");
}

export async function assertSourceReady(root) {
  for (const file of files) {
    await access(resolve(root, file));
  }
  const html = {};
  for (const page of pages) {
    html[page] = await readFile(resolve(root, page), 'utf8');
    if (!html[page].includes('</body>')) {
      throw new Error(`${page} is missing a closing body tag; cannot inject analytics.`);
    }
  }
  if (!html['privacy.html'].includes(cardMark)) {
    throw new Error('privacy.html is missing the <!--voxloom-analytics-card--> marker.');
  }
  return html;
}

export function applyAnalytics(html, enabled) {
  let privacy = html['privacy.html'];
  if (!cardMarkPattern.test(privacy)) {
    throw new Error('privacy.html is missing the <!--voxloom-analytics-card--> marker.');
  }
  privacy = privacy.replace(cardMarkPattern, enabled ? analyticsCard : '');
  if (privacy.includes(cardMark)) {
    throw new Error('privacy.html still contains the analytics card marker after replacement.');
  }
  if (enabled) {
    if (!privacy.includes(dateBefore)) {
      throw new Error(`privacy.html is missing "${dateBefore}" so the built date cannot be updated.`);
    }
    privacy = privacy.replace(dateBefore, dateAfter);
  }
  const built = { ...html, 'privacy.html': privacy };
  if (enabled) {
    for (const page of pages) {
      built[page] = built[page].replace('</body>', `${analyticsSnippet}</body>`);
    }
  }
  return built;
}

export async function buildSite({ root, output, flag: rawFlag }) {
  const enabled = resolveAnalyticsFlag(rawFlag);
  const source = await assertSourceReady(root);
  const built = applyAnalytics(source, enabled);
  await rm(output, { recursive: true, force: true });
  for (const file of files) {
    const destination = resolve(output, file);
    await mkdir(dirname(destination), { recursive: true });
    if (pages.includes(file)) {
      await writeFile(destination, built[file]);
    } else {
      await copyFile(resolve(root, file), destination);
    }
  }
  console.log(`Built ${files.length} static files in public/.`);
}
