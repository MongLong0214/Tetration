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

Studio FX adaptation reference (application code, not the Mediabunny bundle):
MongLong0214/video-art @ 4f373208f95689b11cb068ee8db2018a65083373
https://github.com/MongLong0214/video-art/tree/4f373208f95689b11cb068ee8db2018a65083373

src/lib/effect-composer.ts: polar sector folding and guarded angle calculation
from kaleidoFragmentShader, plus channel sampling from lensDistortionFragmentShader.
TETRA adds actual output aspect, angle control, mirror extension and bounded passes.
src/shaders/layer.frag: glow-wave crest concept; TETRA uses an analytic radial field,
seconds-based speed and mean-centred EV. No phase PNGs, source images, audio,
Ashima/simplex noise, Three.js, postprocessing packages or feedback shaders are
included. Studio's math and finite compositor live in src/studio-fx.js.
