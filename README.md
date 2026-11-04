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

The site points to the published Voxloom v0.2.0 beta release on GitHub Releases. Download buttons link directly to the release's universal `.dmg`; the download page also links the zipped `.app`, `SHA256SUMS`, all releases and GitHub Issues for feedback.

When a new release is published, update the asset URLs and version in `index.html`, `download.html` and `changelog.html`, add the release notes to the changelog, and update the corresponding tests. Keep the minimum macOS version aligned with the app's `bundle.macOS.minimumSystemVersion`. Keep feature descriptions and privacy information aligned with the desktop app's actual behavior.

### Preparing v0.3.0

The v0.3.0 content is explicitly marked **in development / unreleased**. All app download, checksum and release-page links still target the published v0.2.0 assets. The cleanup guide distinguishes v0.2.0's manual import from v0.3.0's planned in-app download. Local cleanup already exists in v0.2.0; the new part is the download flow.

Before turning this preview into release copy:

- Confirm the final app tag and merged feature scope. The preview covers app PRs #148, #149, #151 and #152; do not advertise still-open changes as shipped.
- Verify the public release, actual asset names, checksums, supported macOS version and signing/notarization status. Do not infer those from the version number or a draft release.
- Update the download labels, DMG/ZIP/checksum/release links and install filename together. Preserve the historical v0.2.0 changelog and its asset links.
- Replace the homepage preview with released feature copy; date the v0.3.0 changelog and link the published release and comparison.
- Align cleanup setup with the final UI, including whether manual Import remains. Update the privacy copy and all version-gating tests to match, then run checks, build and desktop/mobile preview.

## Product text

Run `bash scripts/rename.sh "NewName"` to change capitalized product text in root-level HTML and CSS while leaving lowercase app repository URLs unchanged. Reverse with `OLD=NewName bash scripts/rename.sh Voxloom`.

Undo is only lossless if the new name did not already occur in the pages. Review the diff and run checks after changes. Repository links and public URLs are separate from the displayed product name.
