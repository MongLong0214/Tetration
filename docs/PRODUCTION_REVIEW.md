# Production review — TETRA 1.0.0

## 2026-10-06 performance repair

The qualified code head is `a5fb110`, implementation `636eb64`, runtime SHA-256 `416ff519e6ab9bb19a6f69419399c3accb350c61992ea60f765eb57d6166faf3` (267,387 bytes). The frozen 17-suite local run passed all 281 checks with zero uncaught browser errors, followed by four actual Ultra-cancel/navigation/cache-upgrade checks. Final remote qualification [37372511644, attempt 2](https://github.com/MongLong0214/Tetration/actions/runs/37372511644/attempts/2) passed all 17 browser suites and 137 units/lint/build. Both native maximum suites passed all 12 checks without tracing. Successful first-attempt jobs were retained; unsuccessful jobs reran at the same head. The incomplete first attempt remains documented in [VALIDATION.md](VALIDATION.md); its unknown host/driver cause is not asserted to be repaired. No runtime change occurred between attempts.

The review found a real mask-draw failure that looked like a flat query and a separate fivefold cold-render regression at the Auto 4096 BLA boundary. Both have concrete reproductions and repairs. The unchanged failed-draw witness passes on Chromium/WebKit after the GL error guard. Prepared seeded BLA now uses ordinary AA at 4096; the measured Horizon pan improves from the previous public build's 2182 ms to 179 ms, while its cold median remains 19% slower (23% in the later 18-render experiment). Kernel, samples, native dimensions and pixel tolerances remain unchanged. The reproduced native WebKit reference-draw timeout is addressed only by splitting its four affected QA reference cases; actual app flows and all output comparisons pass. The temporary ARM software-WebKit resize throughput limit remains documented; the default x86 runner passes its original bound. See [PERFORMANCE_RESEARCH.md](PERFORMANCE_RESEARCH.md) for inputs, numerical evidence and limits.

The preceding `66b1d78` runtime passed all 281 local browser checks and four additional actual-input/cache checks. Its remote run [37364951935](https://github.com/MongLong0214/Tetration/actions/runs/37364951935) failed before any test step: “The job was not acquired by Runner of type hosted even after multiple attempts.” Browser jobs were skipped. This infrastructure failure is not a passing qualification or a reproduced code failure. The earlier `4246550` diagnostic had the same runner-assignment failure.

The changes and measured numerical/performance evidence are in [PERFORMANCE_RESEARCH.md](PERFORMANCE_RESEARCH.md). Physical Safari/mobile and a five-hour thermal soak remain unqualified. GPU resolution is bounded by 8.3 MP / 8192 per side; FP64 by 1.6 MP / 2048 across; Exact by 72 across. Automatic may select FP64 for high-cap requests.

## Historical 1.0.0 review (2026-10-04)


Review date: 2026-10-04. Scope: the complete source (`src/`), build, server, headers, tests and documentation, reviewed against one goal: explore an effectively unbounded tetration fractal quickly, comfortably and at maximum sharpness, then save and share it.

## Findings in 0.5.0 and what changed

| Finding (0.5.0) | Impact | Change in 1.0.0 | Evidence |
| --- | --- | --- | --- |
| Deep views (pixel spacing below 10⁻¹³) fell back to per-pixel BigInt at **at most 72 horizontal samples** | Zooming in destroyed sharpness; 10⁻¹⁵ and deeper looked like a mosaic | Perturbation: exact reference orbit plus FP32 offsets with an integer exponent on the GPU; FP64 offsets on the CPU fallback | Full display resolution at 5e−11, 7e−25, 7e−100 and 1e−200 (`browser-deep.json`) |
| Medium depths (about 10⁻⁵ to 10⁻¹³) ran on CPU FP64 Workers | Slow; image capped at 2,048 px | Same GPU perturbation path, interactive | Live frames at 10²⁵ (`browser-perf.json`) |
| No rendering while moving; only the previous image was reprojected | Panning revealed black edges; zooming showed stretched pixels until release | Live single-sample frames sized to the measured GPU speed, then progressive refinement | 39–60 live frames per 2 s drag on software WebGL2 |
| Instant jumps on wheel/buttons; no inertia | Navigation felt abrupt | Glide towards the exact target, inertia after flicks; both off with reduced motion | `browser-quality.json` |
| Every deep pixel iterated its whole approach one step at a time (about 30 steps per decade, all pixels within 10⁻⁷ of the reference) | 10¹⁰⁰ views needed seconds per frame even on the GPU | Bilinear approximation: aligned runs of linear steps with validity radii applied in one operation; a separate GPU program used only where it saves a quarter of an orbit, prepared in a quiet moment at perturbation depth | 10¹⁰⁰ frame 4.3× faster, 10⁻⁵⁵ threshold view 11.8×; structured views identical pixel for pixel (`browser-deep.json`, `tests/bla.test.cjs`) |
| Fixed iteration limit (max 1,024) | Deep views turned uniformly unresolved (escape times grow ≈30 steps per decade) | Auto limit `320 + 34 × decades`, up to 16,384 | Escape statistics measured to 10⁻¹⁰⁴; auto limits checked in the deep suite |
| Log-only colour mapping | Deep views collapsed into one or two dark shades | Log + linear band cycling, identical on CPU and GPU | Distinct-colour unit test; deep screenshots |
| WebGPU re-rendered each view once ready; two shader dialects | Double work at startup, more code paths, no precision benefit (also FP32) | Single WebGL2 backend | Bundle checks |
| Workers recreated for every render; whole view recomputed after each tab switch | Startup cost per view; wasted work | Persistent pool; completed views are kept | Code review, release suite |
| `atan(-0., x)` returns π on ANGLE/SwiftShader | Mirrored real fixed points could be recoloured | Real-axis angle resolved explicitly in the palette | Found by the GPU-vs-FP64 harness; covered by symmetry checks |
| Texture ownership by set membership | Overlapping cancelled and new jobs could recycle a texture still read as an adaptive seed | Reference-counted pins and job-held frame sets | Sixty-action leak check: 4 live textures |
| Resize waited 90 ms while still reporting the old render as complete | Stale state; tests could read the wrong size | Resize invalidates at once and refines live | Focus-mode resolution check |
| `preserveDrawingBuffer: false` attempt during the rewrite | Black canvas while tiles were drawn offscreen in Chromium | Kept `true` | Deep display check |

## Final review before release

A second, independent review (six reviewers, each finding checked by two or three skeptics) confirmed and fixed:

| Finding | Fix |
| --- | --- |
| Animated zoom below 1e−128 jumped up to 10⁴² spans and never finished (256-digit truncation in the glide fixed point, 10⁻⁶ scale rounding) | Exact rational fixed point, 53-bit scale factors, glide snaps if it ever stops converging; deep-suite test at 1e−150 |
| Trackpad pinch (ctrl+wheel) got no live frames and zoomed 5.5× slower than the fingers; Safari pinch magnified the page | Pinch is a live gesture with 1:1 gain; Safari gesture events zoom the fractal |
| Without parallel shader compilation the BLA program could link inside a gesture (2 s freeze) | Live frames never link; it is prepared only in a quiet moment |
| A missing reference during motion queued one stale orbit per frame in the Worker (final image seconds late) | One outstanding live-frame request |
| Final image upscaled on DPR-3 phones and blurred at fractional scaling | Density up to 3× within the pixel budget, rounded backing sizes, bar heights on whole device pixels |
| Grabbing during a glide made the camera jump; a tap erased Forward history; key repeat flooded history | Freeze at the displayed camera; history saved only when a gesture moves; repeats coalesced |
| Service worker: any page opened in scope could replace the offline shell; no timeout or 5xx fallback; no navigation preload | Only the app page updates the shell; 3 s deadline and server-error fallback; preload enabled |
| CPU Workers saw cancellation only between tiles | Per-row yield through a message-channel macrotask |
| iOS zoomed into 12 px form fields; error banner overflowed phones; desktop panel dimmed the map | 16 px controls on touch, wrapping banner, transparent backdrop on wide screens |
| Discover stayed busy after a Worker crash; export only checked the PNG header; `serve.cjs` ignored its directory | Fixed; the export is decoded and must contain the fractal; `npm start` serves `dist` as built |

A second round (a completeness critic, six targeted reviewers, every finding refuted or confirmed by two skeptics; 16 confirmed, 5 refuted) added:

| Finding | Fix |
| --- | --- |
| GPU `sin`/`cos` err by ~2e-4 on some drivers (SwiftShader measured), 3× more wrong chaotic pixels than FP32 allows | A start-up probe compares builtins with a multiply-add version and compiles `PRECISE_TRIG` only where needed (direct-view FP64 mismatch 35% → 10%) |
| The 16× stage recomputed the 4 rotated-grid samples of the 4× stage | They lie on the 4×4 grid: 16× reuses them (marked in alpha), ~25% less final-stage work, identical AA error |
| First final render at depth linked the BLA program synchronously even with parallel compilation | Background link on first use; plain program until ready |
| Moving the window to a display with another density kept the old resolution; zoomed-out pages rendered more pixels than the screen | Resolution media query re-measures; density 0.25–3 |
| Live frames covered a slightly different vertical extent than the viewport (stretch between live and final frames) | Shaders map by the viewport aspect, independent of the frame's rounded size |
| One texture-allocation failure switched to the CPU for the session; context loss blacked out the view | Pool freed and budget halved on allocation errors; the last GPU image is kept as a 2D snapshot |
| A failing reference was retried every frame; live frames stopped while a deeper reference was computed | Failures are not retried until Retry or a new spec; live frames use the nearest cached orbit with enough precision meanwhile |
| A batch budget learned on cheap corner tiles could make the next centre batch take seconds | First batch ≤ 4 tiles, growth ≤ 2× per batch, reset after an overrun; tile rates kept apart from live-frame rates |
| Ctrl + mouse wheel was treated as pinch; no-op navigation cleared Forward; same-view navigation restarted a running render | Notches keep the animated path; history saved only on real changes; same-view navigation is a no-op |
| Exact CPU mode noticed cancellation only per 4-pixel row | Per-pixel check |

Not changed: final renders reuse a cached reference within 64 spans, so chaotic pixels can differ from a fresh tab at the same link (structured regions are identical); the FP32 escape threshold can flush below about 1e−90 at the iteration-limit edge; the Open Graph image needs an absolute site URL once a domain exists.

## Engineering review

- **Numerics.** The reference orbit equals an independent decimal BigInt orbit to double rounding at 6 locations (including the branch cut, large and tiny moduli and a 224-digit point). FP64 perturbation agrees with exact per-pixel orbits on every short orbit in 13 views; disagreements occur only in long chaotic orbits (≤5% of pixels), where FP64 *direct* computation disagrees 10–16% of the time. The full value is always formed as `V·exp(ε)`, never `V + d`, which removed a cancellation found during review (78 → 40 mismatches over 3,000 sampled pixels).
- **GPU perturbation.** Structured views match FP64 perturbation pixel for pixel on the GPU; exact 95-digit orbits match sampled GPU pixels at 1e−55. Chaotic views keep the FP64 structure and class statistics (block-average colour difference ≤18/255). Both FP32 reference storage and FP32 offset arithmetic would each need double-float emulation to reproduce FP64 noise pixel for pixel; the visual result was judged equivalent and FP64 remains available as an engine.
- **Bilinear approximation.** Table entries equal the composition of their single linear steps to 10⁻¹² relative; inside each radius every covered step keeps |ε| ≤ 2⁻²⁴ (GPU) or 2⁻⁵³ (Workers) and the run matches exact nonlinear steps within that bound; steps near the threshold, numerical limits, fixed points, period-2 cycles or the end of the reference are never covered. FP64 BLA matches exact orbits as often as plain FP64 perturbation in a chaotic 10²⁵ view, and GPU BLA matches FP64 as often as plain FP32 perturbation (1,263 versus 1,333 mismatches of 2,560 chaotic pixels at 10¹⁰⁰). A first implementation that read past the table on the GPU skipped steps after an early-escaping reference; the browser suite caught it and padded entries now read as radius 0. Two further findings shaped the design: one combined program made the plain loop 1.3–1.6× slower on SwiftShader (hence two programs and the reach heuristic), and compiling the BLA program 1.5 s after the first image halved live frames in a drag that started meanwhile (33 instead of 60 in 2 s), so it is now prepared only at perturbation depth after 2.5 s without input.
- **Scheduling.** GPU work is split into tile batches of about 14 ms with a per-draw orbit-work cap, so no draw approaches driver watchdog limits. Interactive frames drop to coarser resolution on slow GPUs instead of stalling the compositor (deep-view frame-gap p95 66 ms on SwiftShader). Live frames are grid-locked and accumulate up to 16 stratified samples per pixel across frames (converged pixels are copied, not recomputed); refinement of a still camera leaves the GPU idle as long as each frame took, and single-sample final stages never replace a smoother picture. After the linear phase the perturbation offset runs in plain FP32 while |d| ≥ 10⁻²⁰ (1.7–1.8× faster kernels), and each program has one inlined `orbitColor` call site (first deep frame compiles 4.5× faster).
- **State.** Every camera or setting change goes through one invalidation path (`changed`), with a logical camera (exact, shared, rendered) and a visual camera (displayed during glides). Final renders start only when the camera rests and no pointer is down.
- **Security.** CSP with exact hashes, no unsafe-inline/eval, no network access from the page; Workers from `blob:` and the same-origin service worker only. Saved-view names are rendered as text; links and storage are validated and bounded.
- **Resilience.** WebGL context loss falls back to FP64 Workers (including deep perturbation) and recovers on restoration; missing WebGL2, OffscreenCanvas, `scheduler.yield`, Worker quota or Workers entirely all keep the app usable.
- **Accessibility.** Native dialogs with focus management, 44 px targets, keyboard paths for every action, reduced-motion support; axe-core finds no violations in 6 states (colour-contrast over the map is reported as incomplete, as before).

## Numerical and performance limits

Threshold crossing is not a divergence proof; fixed points and periods are candidates. Minimum span `1e-200`; reference precision at most 256 digits; iteration limit at most 16,384. BigInt arithmetic truncates and is not interval-certified. FP32 GPU offsets reproduce structure but not the exact noise inside chaotic regions. Very deep views at high iteration limits need seconds to refine on weak GPUs.

## Release conditions

| Area | Status |
| --- | --- |
| Unit tests, build, Chromium browser suites (review, release, deep, quality, explorer, perf) | Passed locally; see [VALIDATION.md](VALIDATION.md) |
| Linux WebKit suite | Runs in GitHub Actions on pull requests and `main` (the local network policy blocks WebKit downloads; a manual dispatch from this workspace was refused with HTTP 403) |
| Public Vercel HTTPS | Deployed to https://tetration.vercel.app (READY); served bytes and headers still to be checked from a normal browser (see [PUBLISHING.md](PUBLISHING.md)) |
| Physical iPhone/Safari, hardware GPUs, five-hour thermal soak | Not tested |

Public HTTPS review must confirm deployed bytes, headers, Worker execution, the service worker and offline reload, shared-view restoration and PNG export. Physical Safari review must cover pinch input, the share sheet with images, downloads, safe areas, background recovery and installation.
