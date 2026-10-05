# Validation — 1.0.0

Date: 2026-10-04. Current evidence lives in `docs/review/v1.0.0/`. The 0.4.0 and 0.5.0 directories are historical, not new runs.

## Local checks

All suites ran sequentially against one production build served by `serve.cjs` with its CSP and headers intact.

| Suite | Result | Scope |
| --- | --- | --- |
| `npm test` | 123 passed, 0 failed or skipped | Reference orbits against an independent decimal orbit and an mpmath fixture; FP64 perturbation against exact orbits; BLA table algebra, radii, refusal and fidelity; Workers; discovery; CSP, build, server and offline shell; saved views; rendering utilities |
| `npm run lint` | 0 problems | ESLint correctness rules over every source and test script |
| `test:browser` (review) | 29 passed | Core flows, CSP enforcement, exact links, limits, mobile focus and touch |
| `test:release` | 16 passed | Served headers and bytes, reference pixels, engine switching, real context loss and restoration, degraded features, offline reload |
| `test:deep` | 29 passed | GPU perturbation (plain and BLA) against FP64 and exact orbits, BLA speed, full resolution at every depth, symmetry, seams, reference reuse, deep zoom session |
| `test:quality` | 20 passed | Antialiasing error against 64-sample references, live-frame accumulation (converges to the 16-sample image within 3/255; still and panned frames copy converged pixels bit for bit), grid lock, no single-sample image over an antialiased one, glide, inertia, reduced motion, colour flow |
| `test:explorer` | 22 passed | Saved views, history, shortcuts, discovery, sharing, fallbacks, four viewports, axe-core |
| `test:perf` | 11 passed | First image, when the BLA program compiles (never in shallow views, without long tasks at depth), live-frame cadence at the overview, 10²⁵ and 10¹⁰⁰, reference speed, resource bounds |
| `test:webkit` | Not run locally | The network policy of this workspace blocks the WebKit download; the suite runs in GitHub Actions |
| Software GLES (`gpu_software_test.py`) | Not run locally | No EGL in this workspace; it compiles the direct, plain and BLA programs where EGL exists |

No check was skipped or disabled. Six axe-core scans found no violations; colour contrast over the fractal is reported as incomplete, as before, which is not full WCAG certification.

The final build is **208,530 bytes**, SHA-256 **`0d9ffde35f001f651ad741b00ceb922c7adbd726d2e2086385204676adb312a2`**. All six browser reports carry this hash.

## Numerical checks

| Comparison | Result |
| --- | --- |
| Binary reference orbit vs independent decimal BigInt orbit (6 locations, incl. branch cut, tiny and large moduli, a 224-digit point) | Equal to double rounding |
| Reference orbit vs mpmath fixture | Equal to double rounding |
| FP64 perturbation vs exact per-pixel orbits (9 views, 10⁻⁹ … 10⁻¹⁵⁰) | No short-orbit disagreement; long chaotic orbits ≤ 5% |
| GPU perturbation vs FP64 perturbation, 7 structured views (2,560 pixels each) | Pixel for pixel, with BLA automatic and forced on |
| GPU perturbation vs exact 95-digit orbits at 10⁻⁵⁵ (10 sampled pixels) | Colour difference 0 |
| Chaotic views (Plume 10¹¹, Abyss 10²⁵, Horizon 10¹⁰⁰) vs FP64 | Same class statistics (±6%), block-average difference 10.7 / 13.4 / 14.6 of 255 |
| GPU BLA vs plain GPU perturbation against FP64 (chaotic pixels, 2,560 each) | Abyss 1,111 vs 1,113 mismatches, Horizon 1,263 vs 1,333 |
| FP64 BLA vs plain FP64 against exact orbits (chaotic 10²⁵ view, 96 pixels) | Not more mismatches than plain FP64 |
| BLA table entries vs composed single linear steps | Within 10⁻¹² relative |
| Inside each BLA radius | Every covered step keeps \|ε\| ≤ 2⁻²⁴ (GPU) or 2⁻⁵³ (FP64) and matches exact nonlinear steps within that bound |

Chaotic regions are compared statistically because any finite precision, FP64 included, changes individual chaotic pixels.

## Image quality

Adaptive antialiasing against box-filtered 64-sample references (RGB RMSE, 0–255):

| View | 1 sample | Adaptive 4× | Adaptive 16× | Reduction |
| --- | --- | --- | --- | --- |
| Overview (direct) | 23.93 | 10.72 | 5.30 | 78% |
| Filaments (direct) | 35.85 | 17.33 | 8.91 | 75% |
| Plume 10¹¹ (perturbation) | 62.98 | 30.70 | 15.64 | 75% |

Tiled rendering equals one full-frame draw (maximum channel difference 0) for direct and perturbation scenes at 1, 4 and 16 samples. This measures sampling error against the same renderer on a denser grid; it does not certify the mathematical boundary.

## Speed

Chromium 141.0.7390.37 on ANGLE/SwiftShader (software WebGL2, a 4-core CPU host). Hardware GPUs are typically one to two orders of magnitude faster; these numbers are regression bounds for this environment, not device forecasts.

| Measurement | Result |
| --- | --- |
| First image after navigation | 375 ms (complete with adaptive 4× at 960 × 640: 3.9 s) |
| Live frames while dragging, overview / 10²⁵ / 10¹⁰⁰ | 166 / 93 / 79 in 2 s (moves plus accumulation refinements; converged pixels are copied) |
| Display frame-gap 95th percentile in those drags | 16.8 / 16.8 / 33.4 ms (grid-locked, accumulating live frames) |
| Wheel-zoom glide frame-gap 95th percentile | 66.7 ms |
| Exact 10¹⁰⁰ reference orbit (6,144 steps, 140 digits) in a Worker | 73 ms |
| Sixty-action session | 4 live GPU textures, 3 pooled, heap growth 0.22 MB |

Bilinear approximation, same frames with BLA off and automatic (160 × 96, one sample):

| View | Plain | BLA | Speed-up | Pixels changed |
| --- | --- | --- | --- | --- |
| Horizon 10¹⁰⁰, 4,096 steps | 2,435 ms | 572 ms | 4.3× | Chaotic noise only (block difference 14.5) |
| Threshold boundary 10⁻⁵⁵, 512 steps | 450 ms | 38 ms | 11.8× | 0 |
| Plume 10¹¹, 768 steps | 326 ms | 369 ms | — (plain program kept: reach 12 steps) | — |

In the app at 960 × 640 with one sample per pixel, Horizon 10¹⁰⁰ completes in about 25 s with BLA against 97 s without, and a drag shows 60 instead of 24 live frames in 2 s. At 480 × 236 (one sample per pixel, including the reference orbit) the 10¹⁰⁰ render dropped from 22.0 s before BLA to 6.5 s.

## Environment and interpretation

Node 22.22.0 for unit tests (CI uses Node 24), Chromium 141.0.7390.37, Playwright 1.56.0, axe-core 4.11.0, ESLint 10.1.0. Touch, native sharing and some failures (context loss, missing Workers, blocked storage) are emulated in the browser; the context loss uses the real `WEBGL_lose_context` extension. PNGs are decoded and inspected pixel by pixel.

## Remote CI and remaining gaps

[Run 37241756294](https://github.com/MongLong0214/Tetration/actions/runs/37241756294) on `main` at `d3089da` passed all eight jobs: unit tests and build, and the review, release, deep, quality, explorer, perf and WebKit browser suites on GitHub runners. Linux WebKit 26.0 passed 13 checks, including 10¹⁰⁰ at full resolution with BLA on its WebGL2 path (9 table levels, program compiled). [Run 37246543923](https://github.com/MongLong0214/Tetration/actions/runs/37246543923) on `27c82a9` (second review round) also passed all eight jobs. Later commits on `main` are validated by their own runs.

Production is deployed at https://tetration.vercel.app; its served headers were not fetched from this workspace. Physical iPhone/Safari, hardware GPU drivers and a five-hour memory and thermal soak remain unverified.
