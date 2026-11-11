# Voxloom website

Static marketing site for [Voxloom](https://github.com/voxloom-app/voxloom), an on-device dictation app for macOS. The desktop app and its releases are maintained separately.

Visit the [website](https://voxloom.app/).

## Local development

Use Node.js 24. The site uses plain HTML and CSS, with no third-party npm dependencies or application backend. Pages include no client-side JavaScript unless `VOXLOOM_ANALYTICS=1` is set at build time, in which case the build injects only the Vercel Web Analytics script and its `window.va` stub.

```sh
npm ci --ignore-scripts
npm run check
npm run build
python3 -m http.server --directory public 8080
```

Open http://localhost:8080 to preview the generated site.

The build copies only the four HTML pages, two CSS files, favicons, touch icon and social image into `public/`. Documentation, development tools and local environment files are not included in the generated site.

To enable website analytics, set `VOXLOOM_ANALYTICS=1` at build time after turning Web Analytics on for the Vercel project. That injects the official same-origin script on every page and the privacy-page analytics card. `/_vercel/insights/script.js` exists only after Web Analytics is enabled in the Vercel project and a fresh deploy. Until then, and on local static servers, the enabled build's script 404s and analytics is silently off. Leave the variable unset or empty for a build with no analytics script or card. Any other value fails the build. Do not commit a secret; this flag is not a token.

## Checks

`npm run check` validates page metadata, local links and fragments, download and release-link copy, brand colors, the public-file allowlist and unfinished content markers. The repository's CI runs these checks as well.

Run the checks and build before submitting a change. If a public URL changes, update canonical URLs, social-image URLs, footer labels and the corresponding tests together.

## Content updates

The site targets the published Voxloom **v0.4.0** release, dated November 7, 2026. Download labels, universal DMG/ZIP filenames, checksum links and the current release notes target v0.4.0. The version and URLs are static HTML, not a runtime lookup of the latest GitHub release. The historical v0.3.0 and v0.2.0 changelog entries retain its original asset links.

Release changes can be prepared and reviewed before the app release exists. The preview uses the target version's launch copy and URLs; keep the launch PR unmerged until its target assets are public.

### Release validation

Before merging future launch updates:

- Verify the public DMG, ZIP, `SHA256SUMS`, release page and comparison links. Check downloaded artifacts against the published checksums.
- Confirm the final feature scope against the tagged app release. The v0.4.0 notes cover merged app PRs #155, #156, #157, #160 and #165; do not advertise still-open changes as shipped.
- Confirm system requirements and validate signing/notarization on the actual artifacts before asserting them in the pages.
- Add the actual publication date to the changelog; do not invent it while preparing a release.
- Run checks, build and desktop/mobile preview before merging.

For future releases, update active download labels, asset URLs, install filenames, release notes and tests together. Preserve older changelog sections and their asset links. Keep system requirements, feature descriptions, setup instructions and privacy information aligned with the app.

## Product text

Run `bash scripts/rename.sh "NewName"` to change capitalized product text in root-level HTML and CSS while leaving lowercase app repository URLs unchanged. Reverse with `OLD=NewName bash scripts/rename.sh Voxloom`.

Undo is only lossless if the new name did not already occur in the pages. Review the diff and run checks after changes. Repository links and public URLs are separate from the displayed product name.
