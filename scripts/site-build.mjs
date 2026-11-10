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
const cardMarkPattern = /<!--voxloom-analytics-card-->\n?/;
const tokenPattern = /^[0-9a-fA-F]{32}$/;

const analyticsCard = `  <section class="card" aria-labelledby="site-analytics-h"><small>WEBSITE</small><h2 class="h3" id="site-analytics-h">This website, not the app</h2>
    <p>The Voxloom website uses Cloudflare Web Analytics for aggregate page views. Cloudflare's documentation says the beacon uses no cookies and does not collect or use visitors' personal data. The Voxloom app itself does not include this beacon and sends nothing to this service.</p>
  </section>
`;

export function resolveAnalyticsToken(raw) {
  if (raw === undefined || raw === '') return '';
  const token = raw.trim();
  if (!tokenPattern.test(token)) {
    throw new Error('CF_ANALYTICS_TOKEN must be a 32-character hex site token from Cloudflare Web Analytics.');
  }
  return token;
}

export function analyticsSnippet(token) {
  const escaped = token.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${escaped}"}'></script>\n`;
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

export function applyAnalytics(html, token) {
  const snippet = token ? analyticsSnippet(token) : '';
  let privacy = html['privacy.html'];
  if (!cardMarkPattern.test(privacy)) {
    throw new Error('privacy.html is missing the <!--voxloom-analytics-card--> marker.');
  }
  privacy = privacy.replace(cardMarkPattern, snippet ? analyticsCard : '');
  if (privacy.includes(cardMark)) {
    throw new Error('privacy.html still contains the analytics card marker after replacement.');
  }
  if (snippet) {
    if (!privacy.includes(dateBefore)) {
      throw new Error(`privacy.html is missing "${dateBefore}" so the built date cannot be updated.`);
    }
    privacy = privacy.replace(dateBefore, dateAfter);
  }
  const built = { ...html, 'privacy.html': privacy };
  if (snippet) {
    for (const page of pages) {
      built[page] = built[page].replace('</body>', `${snippet}</body>`);
    }
  }
  return built;
}

export async function buildSite({ root, output, token: rawToken }) {
  const token = resolveAnalyticsToken(rawToken);
  const source = await assertSourceReady(root);
  const built = applyAnalytics(source, token);
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
