# Changelog

### WebGPU final stages and steadier live frames — 2026-10-06

- Compute the final 1×, 4× and 16× stages with WebGPU compute where the browser offers it. WebGL2 keeps live frames, presentation, pan reuse and every fallback; any WebGPU error hands the stage back to the WebGL programs. A batch of tiles becomes one queue of samples served by persistent threads, so a lane whose orbit ends early takes the next sample instead of idling beside a long orbit in its SIMD group. Perturbation runs its BLA and floatexp approach in a separate kernel, one thread per sample (neighbouring samples advance in step there, as WebGL fragments do), and hands each sample over in 48 bytes to the persistent plain-step kernel. A single persistent loop over all phases made a whole SIMD group execute the approach whenever one lane was in it, and was slower than WebGL at 10⁻¹⁰⁰. Work is submitted in rounds of 1,024 steps because macOS aborts long threadgroups. Each stage's output stays on the GPU as the next stage's adaptive seed and is uploaded into the same WebGL frames.
- Time to the finished 16× image on a Mac (Chrome on Metal, device pixel ratio 2, 1512×900 window, cold page), before → after: Overview 2.8 → 0.49 s, Bloom 7.2 → 2.0 s, Filaments 3.4 → 0.63 s, Feather 2.9 → 0.45 s, Plume 16.2 → 3.3 s, Abyss 38.6 → 4.5 s, Horizon 46.5 → 7.2 s. Without WebGPU the WebGL path keeps its previous speed.
- Direct views are bit-identical to the WebGL program at every stage. Perturbation pixels differ where the Metal compiler rounds FP32 steps differently: chaotic pixels, as between any two finite-precision engines. Both engines agree equally with FP64 (pixels off by more than 3/255 at 1×: Bloom 17.8% / 17.9%, Abyss 31.5% / 31.4%, Horizon 40.1% / 39.8%, WebGL / WebGPU). The deep suite compares the three WebGPU stages with WebGL and FP64.
- The direct shader stops attracting cycles of period above 2 at the cap once a Brent checkpoint shows the orbit returned and contracted at least 4×. Such pixels can no longer escape, and the unresolved colour does not depend on the final value, so the image is unchanged. Pixels that run to the cap held 92% of the Overview's orbit work and 67% of Bloom's, and most of them (90% and 68%) are such cycles of period 3–64 (256×144 grid, GPU rules). Deep perturbation views measured slower with the same check and do not use it.
- Interleaved live refinement takes new samples in world-locked 8×8 blocks instead of single pixels of a 2×2 pattern. The pixel pattern left three lanes of every quad idle and cost 70–90% of a full frame; interleaved frames now take Bloom 33 → 10 ms, Abyss 48 → 19 ms.
- Live frame sizing ignores frames that had to link a shader program (they measured the link, not the GPU) and re-plans when frames run 1.5× over or 0.5× under the 12 ms budget (previously 2.5× and 0.35×). Before the first live frame of a cap is measured, the estimate starts from the WebGPU stage's rate.
- After a gesture, the 1× stage over the live picture starts from that picture, so finished tiles sharpen it from the centre instead of the stage staying hidden until complete.
- After scripted wheel zooms and drags on the same machine, the finished image arrives in 1.2–2.4 s instead of 3.9–16.9 s, and live frames cover 27–38% of the full width (previously 12–35%) at 46–68 frames per second.

### Overview as the opening view — 2026-10-06

- Opening without a URL hash shows the Overview (x −0.5, y 0, span 8, Auto iterations, palette 0, grid and colour flow off) instead of Bloom. The device-dependent quality default is unchanged: 16× for fine pointers, 4× for coarse ones.

### First-visit shader speed and pan strips — 2026-10-06

- Link every orbit program twice. On ANGLE Metal a program's first link gives a binary measured 2.2–3.7× slower than the program-cache hit returning visitors already got, with different pixels; the second link yields the cached binary's image bit for bit (M2 Pro, 1280×720 1×: Overview 45 → 14 ms, Bloom 103 → 39 ms, BLA Horizon 227 → 102 ms; BLA Abyss showed no difference, 81 vs 80 ms). WebKit's binary and SwiftShader's are the same either way; SwiftShader only pays about 30–120 ms more link time per program. In a cold-cache Bloom Ultra session at 3024×1624 (three alternating runs per build), the page completes in 7.3–8.3 s instead of 17.1–18.0 s, Ultra after an 8-tick wheel zoom in 7.2–7.7 s instead of 16.4–16.9 s and after a 300 px drag in 2.1–3.6 s instead of 5.1–5.3 s; live frames while moving are 21–38% of native width instead of 4–21%. The BLA program is linked twice as well: the two binaries round differently, and the Ultra atlas must stay byte-identical to the plain draw.
- The deep suite's BLA speed check keeps its thresholds (Horizon ≥ 2.5×, 10⁻⁵⁵ ≥ 5×) and times a 960×576 frame, best of five, instead of 160×96: the faster plain program finished that in 1–3 ms, below timer resolution.
- Pending strips of a native pan show the picture already on screen (usually the live frame), resampled into place, instead of blank tiles. Consecutive drags previously replaced a complete live image with up to 69% blank area that filled in tile by tile.

### Parallel perturbation Ultra samples — 2026-10-06

- Compute 512-step perturbation Ultra samples in a bounded tile atlas and sum them in the original FP32 order, preserving AA16, adaptive edges, native dimensions and iteration caps.
- Keep the original direct shader after its separate atlas prototype failed pixel equality; preserve existing atlas resources if a new texture or framebuffer cannot be allocated.
- Add 120 exact original-vs-atlas/fallback conditions to both native maximum suites; full qualification is recorded in [VALIDATION.md](docs/VALIDATION.md).

### Focus resize repair — 2026-10-06

- Focus entry and exit now measure the new viewport immediately, so an old-sized image cannot remain marked complete while resize notification is pending. Native keyboard/button and cached-size checks reproduce the previous stale-completion failure and verify the repair on Chromium and WebKit.

## Exploration performance update — 2026-10-06

- Open Bloom inside its petals, add Detail/region zoom, and retain sharp completed detail during movement.
- Preserve native pan overlaps and compute only exposed strips; bound completed-view cache memory.
- Skip complete repeated FP64 states without changing finite results. One measured native CPU AA16 case improves 30.154 s → 2.209 s with every RGBA byte unchanged; this is not a speed forecast for every scene.
- Select FP64 Workers for dense high-cap Automatic views. Split deep high-cap GPU AA into single-orbit FP32 sums and preserve final rounding, full-state phase and cancellation. Share ordinary/split shader code and skip proven flat adaptive tiles without dropping forced pan samples.
- Keep prepared seeded BLA at the Auto 4096 boundary on ordinary AA after reproducing a fivefold cold-render regression; the measured Horizon pan now completes in 179 ms against the previous public build's 2182 ms.
- Repair WebKit presentation and pooled framebuffer refresh, visible/exported aspect and smoothing, history acceptance, cross-tab clear, density changes and GPU/Worker recovery.
- Explain Auto-dependent emergence: the reproduced point remains unresolved at 768, crosses its threshold at step 838, and appears when Auto reaches 1024. Fixed 1024 preserves it through repeated zooms.
- Add cold maximum input checks and exact FP32 phase/AA comparisons to Chromium and WebKit coverage. Measurements, rejected experiments and qualification limits are in [PERFORMANCE_RESEARCH.md](docs/PERFORMANCE_RESEARCH.md).

## 1.0.0

Infinite zoom at full resolution, live interaction and an installable app.

- **Standard framing.** The overview follows the canonical tetration framing (centre −0.5, width 8, as in Geisler's reference image and Paul Bourke's survey), so the left filament tip near −4.15 is no longer cut off. The opening view (Bloom) widens to centre −1.9, width 3, which keeps the densest petals and shows the surrounding period regions and filaments.
- **Perturbation deep zoom.** One exact reference orbit per view (binary fixed-point BigInt in a Worker, about 3× faster than the previous decimal arithmetic) and per-pixel FP32 offsets on the GPU with a mantissa/exponent representation, series for small arguments, exact threshold differences, rebasing and conjugate mirroring across the branch cut. Every depth down to 1e−200 now renders at full display resolution; the previous deep path stopped at 72 horizontal samples.
- **Bilinear approximation (BLA).** Deep pixels skip aligned runs of linear perturbation steps (`d ← A·d + B·δL`) from a per-view table with validity radii; runs never cover a step near the escape threshold, a numerical limit, a fixed point or a period-2 cycle. On software WebGL2 a 160 × 96 frame at 10¹⁰⁰ renders 4.3× faster (2.4 s → 0.57 s), the 480 × 236 Horizon render drops from 22 s to 6.5 s and a 960 × 640 one from 97 s to 25 s; a 10⁻⁵⁵ threshold view renders 11.8× faster. Structured views are unchanged pixel for pixel; chaotic views keep FP64 statistics. The GPU uses a separate BLA program only where it pays off and prepares it in a quiet moment at perturbation depth (in the background where parallel shader compilation exists); FP64 Workers use BLA too.
- **Final review fixes.** Exact animated zoom down to 1e−200, live 1:1 trackpad pinch (Chromium, Firefox and Safari), no shader compilation during gestures, deduplicated reference requests, up to 3× display density, glide-safe grabbing and cleaner history, a sturdier offline shell (deadline, server-error fallback, navigation preload), per-row Worker cancellation and mobile form, banner and panel fixes.
- **Second review round.** Driver-probed precise trigonometry (sharper chaotic regions on imprecise drivers), 16× stage reuses the 4× samples, exact viewport aspect for every frame, density changes between displays, recovery from texture-allocation failures and context loss without a black view, live frames during reference refresh, bounded GPU batches, Ctrl+wheel and history fixes.
- **No shimmer while moving.** Live frames are grid-locked to the fractal: each frame samples origin + integer pixel index × step, so overlapping pixels are bit-identical from frame to frame; sub-pixel motion and 1/8-octave zoom levels are compositor transforms. Live size stays fixed during a gesture and uses 4 samples when the GPU can afford them. Deep-drag frame-gap p95 dropped from 33–50 ms to 17 ms.
- **No noise while moving.** Live frames accumulate samples over time: every live pixel keeps a running mean of up to 16 stratified samples (the Ultra 4×4 pattern, any prefix stratified), carried between frames by the integer grid shift, so a pan re-uses every overlapping sample and a still camera converges to the 16-sample image (within 3/255) in 16 frames; converged pixels are copied instead of recomputed. A new sampling grid (zoom level, plan or reference change) or the finished image is resampled once and trusted for at most 4 samples, so the first live frame starts antialiased. Single-sample final stages no longer flash over a smooth picture; they appear once antialiased. The live plan no longer drops from 4 to 1 samples on a single slow frame (three in a row, or one very slow), refinement of a still camera leaves the GPU idle as long as each frame took, and inertia uses input timestamps so a busy main thread cannot distort the release velocity.
- **Faster deep zoom.** After the linear (BLA) phase the perturbation offset runs in plain FP32 (the same 24-bit mantissas without floatexp bookkeeping) while |d| ≥ 10⁻²⁰, dropping back to floatexp for rebases and near returns: perturbation kernels run 1.7–1.8× faster. The shaders call `orbitColor` from one place (compilers inline it per call site), so the first deep frame no longer waits 3.2 s for compilation on software WebGL2 (now 0.7 s), and shallow views use the perturbation program once in a quiet moment. Full-resolution renders on software WebGL2: 10¹¹ 4.2 → 2.8 s, 10²⁵ 5.9 → 3.8 s, 10¹⁰⁰ 7.3 → 4.4 s. On slow GPUs live frames refine one world-locked 2×2 phase per frame (a quarter of the cost, four times the pixels), and a finished single-sample stage over a coarser live frame is shown as its 2×2 average instead of waiting for the antialiased stage.
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
