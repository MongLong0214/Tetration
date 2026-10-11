Mediabunny 1.61.3, Copyright (c) 2026-present Vanilagy and contributors.
Licensed under Mozilla Public License 2.0; see LICENSE.mediabunny.

Original source: https://github.com/Vanilagy/mediabunny/tree/v1.61.3/src
Package: https://registry.npmjs.org/mediabunny/-/mediabunny-1.61.3.tgz
The package includes its TypeScript source. No upstream source was modified.
The tree-shaken bundle contains the output and encoding path used by TETRA;
the import list is tools/vendor/entry.js. No codecs/extensions were registered.

Regenerate from the repository root:
  npm ci --prefix tools/vendor --ignore-scripts
  npm run build --prefix tools/vendor

tools/vendor/package-lock.json pins package versions and npm integrity.
SHA256SUMS records the generated bundle bytes. esbuild only runs during explicit
regeneration; npm run build reads the committed bundle without installing or
fetching packages. Bundling/minification and the TetraMedia IIFE name are the
only transformations. This license notice does not relicense the TETRA repository.
