# Validation — 1.0.0

## 2026-10-06 performance repair

The qualified code head is `a5fb110`; its product runtime is `636eb64`, SHA-256 `416ff519e6ab9bb19a6f69419399c3accb350c61992ea60f765eb57d6166faf3` (267,387 bytes). Unit tests: 137 passed; ESLint/actionlint passed. Its frozen 17-suite local run passed all 281 checks with zero uncaught browser errors in 680 seconds, followed by four actual Ultra-cancel/navigation/cache-upgrade checks. Native Chromium and WebKit each passed 12 maximum checks, including actual cold 640×354 / 16,384 / AA16 requests and Settings/Home/Back. AA4/AA16 compare every byte of 138,240 RGBA pixels; finite phase/class/steps compare 6,144 FP32 states exactly. The unchanged native pan witness passed after the Auto 4096 BLA scheduling repair; no pixel tolerance was relaxed.

The default x86 Linux / native macOS [full run 37372511644, attempt 2](https://github.com/MongLong0214/Tetration/actions/runs/37372511644/attempts/2) completed successfully: all 17 browser suites and unit/lint/build passed. Successful first-attempt jobs were retained; only unsuccessful jobs were rerun at the identical head. Both uninstrumented native maximum suites passed all 12 checks. A separate same-runtime Chromium [trace 37375439166](https://github.com/MongLong0214/Tetration/actions/runs/37375439166) also passed all 12 checks; it is supporting evidence, not a substitute for the uninstrumented result. The final documentation changes do not change the runtime bytes. These are served local/CI origins; public-domain checks are a separate delivery verification.

The same-runtime temporary ARM [run 37370299070](https://github.com/MongLong0214/Tetration/actions/runs/37370299070) passed 137 units/lint and 15 of 17 browser suites. Native WebKit cold displays and inputs passed, but its original AA16 reference submission timed out; Linux ARM WebKit missed the unchanged 30-second native-4× resize wait. These are actual failures. [Trace 37371854560](https://github.com/MongLong0214/Tetration/actions/runs/37371854560) isolates the original plain perturbation / 4096 / AA16 / unseeded 8×8 reference draw. QA-only `a5fb110` bounds those four reference cases to 2×2 draws while keeping all other reference cases at 8×8, the same shader/image/pixels/samples/caps and 240-second comparisons. The product bytes remain unchanged. Focused native Chromium/WebKit maximum suites each passed all 12 checks. The remote native WebKit [kernel diagnostic 37373055467](https://github.com/MongLong0214/Tetration/actions/runs/37373055467) passed all five checks in 107 seconds, including the complete AA4/AA16 and FP32 comparisons; it excludes cold app flows and is not full qualification. The default x86 Linux WebKit reuse suite passed all 12 checks with the original 30-second resize bound in [37372511644](https://github.com/MongLong0214/Tetration/actions/runs/37372511644).

That full run's first attempt passed units/lint and eight browser suites. Eight jobs never acquired a runner. Native Chromium maximum passed all cold app flows, high-cap pans, FP64 extension fallback and adaptive-mask witnesses, but stopped emitting logs after 21:04:03 UTC before the AA4 comparison. No final success or watchdog failure was available over 18 minutes later. Cancellation was requested; this incomplete execution is not credited as a pass and its exact host/driver cause is unknown. Same-head attempt 2 completed successfully, including this uninstrumented suite. No runtime change was made between attempts.

The preceding `7b7b076` runtime passed all 281 local checks, including native Chromium/WebKit mask checks with a real failed draw: the unchanged witness fails before the repair and passes after it. Standard [run 37366705774](https://github.com/MongLong0214/Tetration/actions/runs/37366705774) failed before any test step because no hosted runner was acquired. A temporary branch changes only two Linux runner labels to official Ubuntu 24.04 ARM. Its [run 37367320285](https://github.com/MongLong0214/Tetration/actions/runs/37367320285) passed 137 units/lint and 12 of 17 browser suites, including native macOS Chromium maximum. Five jobs never started and report runner-assignment failure; native WebKit maximum was among them. This is not a full passing run. [Run 37370299070](https://github.com/MongLong0214/Tetration/actions/runs/37370299070) repeats all 17 suites on the current runtime. Native macOS jobs and every test input/tolerance/deadline are unchanged.

The preceding `66b1d78` runtime passed all 281 local browser checks and four additional actual-input/cache checks. Its remote run [37364951935](https://github.com/MongLong0214/Tetration/actions/runs/37364951935) failed before any test step: “The job was not acquired by Runner of type hosted even after multiple attempts.” Browser jobs were skipped. This infrastructure failure is not a passing qualification or a reproduced code failure. The earlier `4246550` diagnostic had the same runner-assignment failure.

The changes and measured numerical/performance evidence are in [PERFORMANCE_RESEARCH.md](PERFORMANCE_RESEARCH.md). Physical Safari/mobile and a five-hour thermal soak remain unqualified. GPU resolution is bounded by 8.3 MP / 8192 per side; FP64 by 1.6 MP / 2048 across; Exact by 72 across. Automatic may select FP64 for high-cap requests.

## Historical 1.0.0 review (2026-10-04)


Date: 2026-10-04. Historical evidence lives in `docs/review/v1.0.0/`. The 0.4.0 and 0.5.0 directories are historical, not new runs.

## Local checks

All suites ran sequentially against one production build served by `serve.cjs` with its CSP and headers intact.

| Suite | Result | Scope |
| --- | --- | --- |
| `npm test` | 123 passed, 0 failed or skipped | Reference orbits against an independent decimal orbit and an mpmath fixture; FP64 perturbation against exact orbits; BLA table algebra, radii, refusal and fidelity; Workers; discovery; CSP, build, server and offline shell; saved views; rendering utilities |
| `npm run lint` | 0 problems | ESLint correctness rules over every source and test script |
| `test:browser` (review) | 29 passed | Core flows, CSP enforcement, exact links, limits, mobile focus and touch |
| `test:release` | 16 passed | Served headers and bytes, reference pixels, engine switching, real context loss and restoration, degraded features, offline reload |
| `test:deep` | 29 passed | GPU perturbation (plain and BLA) against FP64 and exact orbits, BLA speed, full resolution at every depth, symmetry, seams, reference reuse, deep zoom session |
| `test:quality` | 22 passed | Antialiasing error against 64-sample references, live-frame accumulation and interleaved refinement (both converge to the 16-sample image within 3/255; still and panned frames copy converged pixels bit for bit), grid lock, no single-sample image over an antialiased one, glide, inertia, reduced motion, colour flow |
| `test:explorer` | 22 passed | Saved views, history, shortcuts, discovery, sharing, fallbacks, four viewports, axe-core |
| `test:perf` | 12 passed | First image, when the BLA program compiles (never in shallow views, without long tasks at depth), the perturbation program prepared in a quiet shallow moment, live-frame cadence at the overview, 10²⁵ and 10¹⁰⁰, reference speed, resource bounds |
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
| Live frames while dragging, overview / 10²⁵ / 10¹⁰⁰ | 166 / 112 / 102 in 2 s (moves plus accumulation refinements; converged pixels are copied) |
| Display frame-gap 95th percentile in those drags | 16.8 / 16.8 / 16.8 ms (grid-locked, accumulating live frames) |
| Full display resolution (480 × 236, one sample) at 10¹¹ / 10²⁵ / 10¹⁰⁰ / 10⁻²⁰⁰, including the reference and shader preparation | 2.8 / 3.8 / 4.4 / 1.9 s (before the plain FP32 phase and the single `orbitColor` call site: 4.2 / 5.9 / 7.3 / 2.1 s) |
| First perturbation draw (driver compiles the program lazily) | 0.7 s (3.2 s with four inlined `orbitColor` call sites) |
| Wheel-zoom glide frame-gap 95th percentile | 66.7 ms |
| Exact 10¹⁰⁰ reference orbit (6,144 steps, 140 digits) in a Worker | 73 ms |
| Sixty-action session | 4 live GPU textures, 3 pooled, heap growth 0.22 MB |

Bilinear approximation, same frames with BLA off and automatic (160 × 96, one sample):

| View | Plain | BLA | Speed-up | Pixels changed |
| --- | --- | --- | --- | --- |
| Horizon 10¹⁰⁰, 4,096 steps | 2,493 ms | 332 ms | 7.5× | Chaotic noise only (block difference 14.5) |
| Threshold boundary 10⁻⁵⁵, 512 steps | 450 ms | 38 ms | 11.8× | 0 |
| Plume 10¹¹, 768 steps | 326 ms | 369 ms | — (plain program kept: reach 12 steps) | — |

In the app at 960 × 640 with one sample per pixel, Horizon 10¹⁰⁰ completes in about 25 s with BLA against 97 s without, and a drag shows 60 instead of 24 live frames in 2 s. At 480 × 236 (one sample per pixel, including the reference orbit) the 10¹⁰⁰ render dropped from 22.0 s before BLA to 6.5 s. With the plain FP32 phase, the 960 × 640 Horizon render completes in 15.4 s.

## Environment and interpretation

Node 22.22.0 for unit tests (CI uses Node 24), Chromium 141.0.7390.37, Playwright 1.56.0, axe-core 4.11.0, ESLint 10.1.0. Touch, native sharing and some failures (context loss, missing Workers, blocked storage) are emulated in the browser; the context loss uses the real `WEBGL_lose_context` extension. PNGs are decoded and inspected pixel by pixel.

## Remote CI and remaining gaps

[Run 37241756294](https://github.com/MongLong0214/Tetration/actions/runs/37241756294) on `main` at `d3089da` passed all eight jobs: unit tests and build, and the review, release, deep, quality, explorer, perf and WebKit browser suites on GitHub runners. Linux WebKit 26.0 passed 13 checks, including 10¹⁰⁰ at full resolution with BLA on its WebGL2 path (9 table levels, program compiled). [Run 37246543923](https://github.com/MongLong0214/Tetration/actions/runs/37246543923) on `27c82a9` (second review round) also passed all eight jobs. Later commits on `main` are validated by their own runs.

Production is deployed at https://tetration.vercel.app; its served headers were not fetched from this workspace. Physical iPhone/Safari, hardware GPU drivers and a five-hour memory and thermal soak remain unverified.
