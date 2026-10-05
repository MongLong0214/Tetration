# Changelog

## 1.0.0

Infinite zoom at full resolution, live interaction and an installable app.

- **Perturbation deep zoom.** One exact reference orbit per view (binary fixed-point BigInt in a Worker, about 3× faster than the previous decimal arithmetic) and per-pixel FP32 offsets on the GPU with a mantissa/exponent representation, series for small arguments, exact threshold differences, rebasing and conjugate mirroring across the branch cut. Every depth down to 1e−200 now renders at full display resolution; the previous deep path stopped at 72 horizontal samples.
- **Bilinear approximation (BLA).** Deep pixels skip aligned runs of linear perturbation steps (`d ← A·d + B·δL`) from a per-view table with validity radii; runs never cover a step near the escape threshold, a numerical limit, a fixed point or a period-2 cycle. On software WebGL2 a 160 × 96 frame at 10¹⁰⁰ renders 4.3× faster (2.4 s → 0.57 s), the 480 × 236 Horizon render drops from 22 s to 6.5 s and a 960 × 640 one from 97 s to 25 s; a 10⁻⁵⁵ threshold view renders 11.8× faster. Structured views are unchanged pixel for pixel; chaotic views keep FP64 statistics. The GPU uses a separate BLA program only where it pays off and prepares it in a quiet moment at perturbation depth (in the background where parallel shader compilation exists); FP64 Workers use BLA too.
- **Final review fixes.** Exact animated zoom down to 1e−200, live 1:1 trackpad pinch (Chromium, Firefox and Safari), no shader compilation during gestures, deduplicated reference requests, up to 3× display density, glide-safe grabbing and cleaner history, a sturdier offline shell (deadline, server-error fallback, navigation preload), per-row Worker cancellation and mobile form, banner and panel fixes.
- **Second review round.** Driver-probed precise trigonometry (sharper chaotic regions on imprecise drivers), 16× stage reuses the 4× samples, exact viewport aspect for every frame, density changes between displays, recovery from texture-allocation failures and context loss without a black view, live frames during reference refresh, bounded GPU batches, Ctrl+wheel and history fixes.
- **Auto iterations** grow with depth (`320 + 34 × decades`, up to 16,384); fixed limits now reach 16,384.
- **Live interaction.** Dragging, pinching and wheel zoom show freshly computed single-sample frames sized to the GPU's measured speed; wheel and button zooms glide, drags carry inertia (both disabled by reduced motion). The final render no longer recomputes after tab switches when it was complete, and window resizes refine immediately.
- **Ultra quality** (default on precise pointers) adds adaptive 16-sample edges after the 4-sample pass, with a rotated-grid 4-sample pattern. Measured error against 64-sample references fell by 78% versus one sample in the overview.
- **Speed.** Adaptive tile batches (~14 ms each) with a texture pool, persistent Worker pool (up to 8), reference reuse while panning and zooming, and a fast fence-polling path.
- **Colour at depth.** Escape bands combine the logarithmic mapping with a linear cycle so deep views no longer collapse into one shade. A driver bug (`atan(-0., x)` returning π on ANGLE/SwiftShader) that recoloured mirrored fixed points is avoided.
- **Discover** (D) jumps to a new detailed place; three deep starting points (Plume 10¹¹, Abyss 10²⁵, Horizon 10¹⁰⁰) join the presets.
- **Sharing.** Save image opens the native share sheet with the PNG on supporting touch devices.
- **Installable offline shell.** Manifest, icons rendered from the fractal and a network-first service worker.
- **Robustness.** GPU context restoration returns to the GPU; the main thread computes references when Workers are blocked; reference-counted frame ownership prevents texture reuse while a stage still reads it.
- **Security headers.** HSTS, Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy; the CSP allows the same-origin service worker and manifest only.
- WebGPU was removed. It used the same FP32 arithmetic, doubled the shader code paths and re-rendered every view once it became ready; WebGL2 is available in every supported browser.
- Test suites rewritten: 122 unit tests and seven browser suites, including GPU-versus-exact pixel comparisons at every depth, BLA equality and speed checks, performance budgets and leak checks. ESLint correctness rules cover every source and test script.

Finite classifiers keep their thresholds; GPU rules (−80 underflow, |b| > 10⁶, tolerance 2·10⁻⁶) now also govern GPU perturbation, so the image does not change when the camera crosses between direct and perturbation rendering.

## 0.5.0

- Added Aurora, Ember and Tidal palettes, finite fixed-point phase shading, an optional slow color cycle, and more visually useful starting points. Mono remains available.
- Raised GPU detail to the bounded display grid and added adaptive four-sample antialiasing. GPU-resident center-first tiles avoid per-tile image readbacks.
- Reproject cached images during gestures instead of recomputing every pointer move. Cancelled jobs cannot enqueue an unbounded stream of GPU tiles.
- Increased FP64 final sampling to at most 1.6 million pixels / 2,048 across. High-precision limits remain unchanged.
- Fixed a reproduced CPU preview jump at the start of replacement Worker computation.
- Shared views preserve hue and quality without autoplay. PNG capture freezes hue, coordinates, grid and completion state.
- Added independent supersampling error comparisons, tile-seam checks, gesture draw-count checks and CPU preview regression coverage.

Finite orbit classifiers and high-precision arithmetic are unchanged. Colors and rendering quality do not certify the mathematical boundary.

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
