# Production review — TETRA 0.5.0

Review date: 2026-10-04. **Beta release candidate. Full commercial readiness remains withheld pending the deployment and device conditions below.**

## Scope and provenance

Continues public main `4b16c005c635ac73ee0f11019524e8e1d68f5f4c` and the reviewed 0.2.0 archive. No framework migration, backend, paid integration, runtime dependency or license change. The finite orbit classifiers and `precision.js` are unchanged; the numerical core's display palette is updated.

Reviewed the user path: open → choose a starting point → pan/zoom → change quality/palette/engine → focus → save/reopen → share/reopen → export. Failure paths include cancelled work, GPU loss, unavailable image-transfer features, blocked storage/clipboard, precise-coordinate drafts, small viewports and CSP enforcement.

## Improvements and defects

| Finding | Change | Evidence |
| --- | --- | --- |
| Low final sampling exposed coarse pixels | Bounded display-resolution GPU frames; adaptive four-sample edges; high-quality CPU image interpolation | Pixel dimensions and independent 16-sample image comparison |
| Every drag movement launched orbit work | Reproject the cached image; restart tiles after release | Zero GPU tile draws during the recorded drag; frame timing record |
| Copying tile images to the CPU added overhead | GPU-resident textures/framebuffers, scissored tiles, nonblocking completion waits | WebGL2/WebGPU output and export checks; no seam error in sampled WebGL2 image |
| Cancelled GPU work could overlap replacement submission | Await the outstanding tile before a new frame starts | Cancellation and renderer-loss regressions |
| The monochrome map did not support the requested visual experience | Three continuous ramps, observed fixed-point phase tint, optional hue flow, curated finite-coordinate views | Actual screenshots, all-palette reference pixels and motion/share checks |
| CPU preview returned to the old camera while new Workers started | Bake the cached transform into the CPU seed image | Reproduced channel error 245 before the fix, at most 1 permitted after it with Worker replies intentionally withheld |
| Export could change presentation state while capture was pending | Freeze camera, hue, grid and completion state before asynchronous capture | Completed and partial PNG checks across navigation |

The antialiasing detector compares a native one-sample image with its neighbors. It only recomputes detected edges, so it is not exhaustive supersampling and can miss subpixel structures. The image-quality comparison covers one sampled camera, not every boundary. Palettes represent finite observations; no artificial detail or generated artwork is used for the map.

## Engineering review

- Explicit frame ownership retains the native image for the adaptive pass and releases superseded textures. A cancelled incomplete frame cannot replace a newer camera.
- WebGPU qualification, WebGL2 context loss and Worker fallback are exercised in actual browsers using software graphics drivers.
- Display work is bounded to 8,294,400 pixels, device density at most 2 and each GPU dimension at most 8,192. FP64 is bounded to 1.6 million samples / 2,048 across. This bounds work, not device memory availability or completion time.
- The map and controls are English. Keyboard commands, modal focus, primary target sizes, exact links, local saved views and blocked-storage behavior are tested.
- The production CSP remains enabled, with exact script/style hashes and no unsafe-eval or unsafe-inline allowance. No analytics or network computation service was added.
- Flow is optional, pauses while hidden and stops on a reduced-motion preference change. A copied URL does not turn it on.

## Numerical and performance limits

Threshold crossing is not a divergence proof; fixed points and periods are candidates. Minimum span remains `1e-200`, high-precision orbit arithmetic at most 240 decimal places, and deep final images at most 72 horizontal samples. BigInt arithmetic is truncated rather than interval-certified. Smooth interpolation cannot restore uncomputed deep detail.

The updated full-resolution antialiased frame takes longer to finish than the old smaller single-sample frame on the measured software GPU. Interaction becomes smoother because dragging reuses the image. The exact comparison, environment and bundle hash are in [VALIDATION.md](VALIDATION.md). Neither continuous real-time rendering at every coordinate nor a five-hour session is certified.

## Release conditions

| Area | Current status |
| --- | --- |
| Local units, browser interactions, software GPU, quality checks | Passed; see current evidence |
| Remote GitHub CI, including Linux WebKit | Recorded after the actual run in the publication/validation documents |
| Public Vercel HTTPS | Not yet verified; current team-scope lookup returns HTTP 403 |
| Physical iPhone/Safari and hardware GPU | Not tested |
| Five-hour sustained memory, battery and thermal behavior | Not tested |

Public HTTPS review must confirm deployed bytes, security headers, Worker execution, shared-view restoration and PNG export. Physical Safari review must cover actual pinch input, OS sharing, downloads, safe areas and background recovery. Linux WebKit and touch emulation do not replace these checks.
