# Production review — TETRA 1.0.0

Review date: 2026-10-04. Scope: the complete source (`src/`), build, server, headers, tests and documentation, reviewed against one goal: explore an effectively unbounded tetration fractal quickly, comfortably and at maximum sharpness, then save and share it.

## Findings in 0.5.0 and what changed

| Finding (0.5.0) | Impact | Change in 1.0.0 | Evidence |
| --- | --- | --- | --- |
| Deep views (pixel spacing below 10⁻¹³) fell back to per-pixel BigInt at **at most 72 horizontal samples** | Zooming in destroyed sharpness; 10⁻¹⁵ and deeper looked like a mosaic | Perturbation: exact reference orbit plus FP32 offsets with an integer exponent on the GPU; FP64 offsets on the CPU fallback | Full display resolution at 5e−11, 7e−25, 7e−100 and 1e−200 (`browser-deep.json`) |
| Medium depths (about 10⁻⁵ to 10⁻¹³) ran on CPU FP64 Workers | Slow; image capped at 2,048 px | Same GPU perturbation path, interactive | Live frames at 10²⁵ (`browser-perf.json`) |
| No rendering while moving; only the previous image was reprojected | Panning revealed black edges; zooming showed stretched pixels until release | Live single-sample frames sized to the measured GPU speed, then progressive refinement | 39–60 live frames per 2 s drag on software WebGL2 |
| Instant jumps on wheel/buttons; no inertia | Navigation felt abrupt | Glide towards the exact target, inertia after flicks; both off with reduced motion | `browser-quality.json` |
| Fixed iteration limit (max 1,024) | Deep views turned uniformly unresolved (escape times grow ≈30 steps per decade) | Auto limit `320 + 34 × decades`, up to 16,384 | Escape statistics measured to 10⁻¹⁰⁴; auto limits checked in the deep suite |
| Log-only colour mapping | Deep views collapsed into one or two dark shades | Log + linear band cycling, identical on CPU and GPU | Distinct-colour unit test; deep screenshots |
| WebGPU re-rendered each view once ready; two shader dialects | Double work at startup, more code paths, no precision benefit (also FP32) | Single WebGL2 backend | Bundle checks |
| Workers recreated for every render; whole view recomputed after each tab switch | Startup cost per view; wasted work | Persistent pool; completed views are kept | Code review, release suite |
| `atan(-0., x)` returns π on ANGLE/SwiftShader | Mirrored real fixed points could be recoloured | Real-axis angle resolved explicitly in the palette | Found by the GPU-vs-FP64 harness; covered by symmetry checks |
| Texture ownership by set membership | Overlapping cancelled and new jobs could recycle a texture still read as an adaptive seed | Reference-counted pins and job-held frame sets | Sixty-action leak check: 4 live textures |
| Resize waited 90 ms while still reporting the old render as complete | Stale state; tests could read the wrong size | Resize invalidates at once and refines live | Focus-mode resolution check |
| `preserveDrawingBuffer: false` attempt during the rewrite | Black canvas while tiles were drawn offscreen in Chromium | Kept `true` | Deep display check |

## Engineering review

- **Numerics.** The reference orbit equals an independent decimal BigInt orbit to double rounding at 6 locations (including the branch cut, large and tiny moduli and a 224-digit point). FP64 perturbation agrees with exact per-pixel orbits on every short orbit in 13 views; disagreements occur only in long chaotic orbits (≤5% of pixels), where FP64 *direct* computation disagrees 10–16% of the time. The full value is always formed as `V·exp(ε)`, never `V + d`, which removed a cancellation found during review (78 → 40 mismatches over 3,000 sampled pixels).
- **GPU perturbation.** Structured views match FP64 perturbation pixel for pixel on the GPU; exact 95-digit orbits match sampled GPU pixels at 1e−55. Chaotic views keep the FP64 structure and class statistics (block-average colour difference ≤18/255). Both FP32 reference storage and FP32 offset arithmetic would each need double-float emulation to reproduce FP64 noise pixel for pixel; the visual result was judged equivalent and FP64 remains available as an engine.
- **Scheduling.** GPU work is split into tile batches of about 14 ms with a per-draw orbit-work cap, so no draw approaches driver watchdog limits. Interactive frames drop to coarser resolution on slow GPUs instead of stalling the compositor (deep-view frame-gap p95 66 ms on SwiftShader).
- **State.** Every camera or setting change goes through one invalidation path (`changed`), with a logical camera (exact, shared, rendered) and a visual camera (displayed during glides). Final renders start only when the camera rests and no pointer is down.
- **Security.** CSP with exact hashes, no unsafe-inline/eval, no network access from the page; Workers from `blob:` and the same-origin service worker only. Saved-view names are rendered as text; links and storage are validated and bounded.
- **Resilience.** WebGL context loss falls back to FP64 Workers (including deep perturbation) and recovers on restoration; missing WebGL2, OffscreenCanvas, `scheduler.yield`, Worker quota or Workers entirely all keep the app usable.
- **Accessibility.** Native dialogs with focus management, 44 px targets, keyboard paths for every action, reduced-motion support; axe-core finds no violations in 7 states (colour-contrast over the map is reported as incomplete, as before).

## Numerical and performance limits

Threshold crossing is not a divergence proof; fixed points and periods are candidates. Minimum span `1e-200`; reference precision at most 256 digits; iteration limit at most 16,384. BigInt arithmetic truncates and is not interval-certified. FP32 GPU offsets reproduce structure but not the exact noise inside chaotic regions. Very deep views at high iteration limits need seconds to refine on weak GPUs.

## Release conditions

| Area | Status |
| --- | --- |
| Unit tests, build, Chromium browser suites (review, release, deep, quality, explorer, perf) | Passed locally; see [VALIDATION.md](VALIDATION.md) |
| Linux WebKit suite | Runs in GitHub Actions (the local network policy blocks WebKit downloads) |
| Public Vercel HTTPS | Not verified (see [PUBLISHING.md](PUBLISHING.md)) |
| Physical iPhone/Safari, hardware GPUs, five-hour thermal soak | Not tested |

Public HTTPS review must confirm deployed bytes, headers, Worker execution, the service worker and offline reload, shared-view restoration and PNG export. Physical Safari review must cover pinch input, the share sheet with images, downloads, safe areas, background recovery and installation.
