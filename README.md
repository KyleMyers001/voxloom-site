# Voxloom website

Static marketing site for [Voxloom](https://github.com/KyleMyers001/voxloom), an on-device dictation app for macOS. The desktop app and its releases are maintained separately.

Visit the [website](https://voxloom.app/).

## Local development

Use Node.js 24. The site uses plain HTML and CSS, with no third-party npm dependencies, client-side JavaScript or application backend.

```sh
npm ci --ignore-scripts
npm run check
npm run build
python3 -m http.server --directory public 8080
```

Open http://localhost:8080 to preview the generated site.

The build copies only the four HTML pages, two CSS files, favicons, touch icon and social image into `public/`. Documentation, development tools and local environment files are not included in the generated site.

## Checks

`npm run check` validates page metadata, local links and fragments, download and release-link copy, brand colors, the public-file allowlist and unfinished content markers. The repository's CI runs these checks as well.

Run the checks and build before submitting a change. If a public URL changes, update canonical URLs, social-image URLs, footer labels and the corresponding tests together.

## Content updates

This branch prepares the website for Voxloom **v0.3.0**. Download labels, universal DMG/ZIP filenames, checksum links and the current release notes already target v0.3.0. The version and URLs are static HTML, not a runtime lookup of the latest GitHub release. The historical v0.2.0 changelog retains its original asset links.

Release changes can be prepared and reviewed before the app release exists. The preview uses the target version's launch copy and URLs; keep the launch PR unmerged until its target assets are public.

### v0.3.0 merge checklist

- Publish the app's v0.3.0 release, then verify the actual DMG, ZIP and `SHA256SUMS` against the links already in these pages. The filenames follow the app's signed universal packaging convention; their public availability is a release gate, not a local test result.
- Confirm final feature scope. These notes cover merged app PRs #148, #149, #151, #152 and #154. Do not advertise still-open changes as shipped.
- Confirm macOS requirements and the actual signing/notarization outcome. The pages do not assert a v0.3.0 notarization result in advance.
- Add the actual publication date to the v0.3.0 changelog if desired; do not invent it while preparing the release.
- Run checks, build and desktop/mobile preview, then merge the website PR when the release is ready.

For future releases, update active download labels, asset URLs, install filenames, release notes and tests together. Preserve older changelog sections and their asset links. Keep system requirements, feature descriptions, setup instructions and privacy information aligned with the app.

## Product text

Run `bash scripts/rename.sh "NewName"` to change capitalized product text in root-level HTML and CSS while leaving lowercase app repository URLs unchanged. Reverse with `OLD=NewName bash scripts/rename.sh Voxloom`.

Undo is only lossless if the new name did not already occur in the pages. Review the diff and run checks after changes. Repository links and public URLs are separate from the displayed product name.
