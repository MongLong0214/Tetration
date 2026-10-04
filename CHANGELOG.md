# Changelog

## 0.4.0

- Replaced the decorative sidebar with an edge-to-edge monochrome map and an on-demand native controls dialog.
- Converted all product copy and current documentation to English.
- Added focus mode, forward navigation, keyboard shortcuts and up to 24 named local views.
- Added native sharing on supported touch devices and preserved exact-coordinate clipboard/manual fallbacks.
- Replaced all map palettes with achromatic shading in FP64, BigInt, GLSL and WGSL paths.
- Removed synchronous WebGPU snapshots from interactive previews. Final snapshots use an asynchronous ImageBitmap path where available; PNG metadata describes the captured view.
- Fixed controls-panel scrolling and coordinate draft loss during viewport resizing.
- Added display-cutout spacing, 44px primary touch targets, visible render retry and automated accessibility checks.
- Added Linux WebKit regression coverage and CI browser artifacts.
- Replaced outdated review bundles and prototype screenshots with current evidence. Prior project versions remain in Git history.

The orbit classifiers, precision limits and camera bounds remain unchanged. Only `color()` changed in the numerical core file.

## 0.3.0

Qualified WebGPU previews, parallel Workers, OffscreenCanvas tile transfer and scheduler yielding. Published in PR #1; source commit `4d89ce9df8622748dbb9b59878f5d182c2182880` passed remote CI.

## 0.2.0 provenance

Continued from the reviewed source archive with SHA-256 `89ac19d248b8ca3f488ae6cbd0c6d2323e0b338058ba4644017c8e6acab1364c`.
