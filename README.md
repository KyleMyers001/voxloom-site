# Voxloom website

Static marketing site for [Voxloom](https://github.com/KyleMyers001/voxloom), an on-device dictation app for macOS. The desktop app and its releases are maintained separately.

Visit the [website](https://voxloom.vercel.app/).

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

`npm run check` validates page metadata, local links and fragments, download-availability copy, brand colors, the public-file allowlist and unfinished content markers. The repository's CI runs these checks as well.

Run the checks and build before submitting a change. If a public URL changes, update canonical URLs, social-image URLs, footer labels and the corresponding tests together.

## Content updates

There is no public app download yet. Homepage download buttons lead to an availability page, which links to the app's public releases listing.

When a public release becomes available, update download links, version information, release notes, installation guidance and the corresponding tests. Keep feature descriptions and privacy information aligned with the desktop app's actual behavior.

## Product text

Run `bash scripts/rename.sh "NewName"` to change capitalized product text in root-level HTML and CSS while leaving lowercase app repository URLs unchanged. Reverse with `OLD=NewName bash scripts/rename.sh Voxloom`.

Undo is only lossless if the new name did not already occur in the pages. Review the diff and run checks after changes. Repository links and public URLs are separate from the displayed product name.
