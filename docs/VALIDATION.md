# Validation — 0.5.0

Date: 2026-10-04. Current evidence lives in `docs/review/v0.5.0/`. Earlier 0.4.0 evidence is historical, not a new run.

## Local checks

| Suite | Result | Scope |
| --- | --- | --- |
| `npm test` | 68 passed; 0 failed/skipped | Finite numerical references, arithmetic, Workers, CSP/build/server, saved views, resolution/tiling and hue utilities |
| `test:browser` | 29 passed | Input, precision, CSP and mobile emulation |
| `test:release` | 16 passed | WebGL2, context loss, sharing, exact links and HTTP headers |
| `test:modern` | 12 passed | Actual WebGPU, 20 stable reference pixels across all palettes, completed/partial PNGs, ImageBitmap fallback and parallel Workers |
| `test:quality` | 9 passed | Native dimensions, tile seams, adaptive AA error, cached drag, hue flow, shared quality/hue, reduced motion and CPU pending-preview regression |
| `test:explorer` | 21 passed | Saved views, history, focus, draft preservation, share/storage fallbacks, four viewport sizes and accessibility |
| Software GLES | 8 passed | Actual production shader compilation/link and selected finite reference pixels |

All served-browser checks kept the production CSP intact. No unsafe-inline, unsafe-eval or CSP bypass was added. Six axe-core scans found zero violations, but color-contrast returned incomplete nodes; this is not full WCAG certification. Neutral controls, focus handling and touch targets are separately inspected/tested.

The final local HTML is **110,075 bytes**, SHA-256 **`df4815f01272ee8181e458d5875e3f2cd77a53c80181c9fc5727b931a1eeb677`**. All five current browser JSON reports carry this hash. `precision.js` and the finite orbit classifier section of `core.js` were compared byte-for-byte with the baseline and are unchanged.

## Image quality

At camera `x=-0.2, y=0, span=7`, 256 iterations and a 192 × 192 image, an independent 768 × 768 single-sample draw was box-averaged in JavaScript to supply a 16-sample-per-pixel reference.

| Measurement | Result |
| --- | --- |
| Single-sample RGB RMSE | 23.2231 |
| Adaptive-AA RGB RMSE | 11.1385 |
| Error reduction in this sampled image | 52.0% |
| Pixels changed by adaptive AA | 6,424 / 36,864 |
| Tiled versus full-frame maximum channel difference | 0 |

This measures sampling error against the same finite FP32 renderer at a denser grid. It is not an independent mathematical correctness proof or a universal boundary-quality guarantee. Four samples are used only at detected edges; subpixel structures can still alias.

## Interaction and completion time

One controlled run per release on Chromium 153.0.8010.0, ANGLE/SwiftShader, 1440 × 960 viewport, DPR 1, overview camera, 256 iterations. Mouse movement is Playwright-driven. The software GPU and test host are not a user's hardware performance forecast.

| Measurement | 0.4.0 | 0.5.0 |
| --- | --- | --- |
| Final computed grid | 1,221 × 737 | 1,440 × 870 |
| Sampling | One per pixel | One per pixel + adaptive four-sample edges |
| Initial completion observed by Playwright | 0.82 s | 4.07 s |
| GPU orbit draws during 30 held-pointer moves | 30 | 0 |
| Drag frame-gap 95th percentile | 33.4 ms | 16.7 ms |
| Time to deliver the 30 mouse moves | 1.46 s | 0.50 s |

For 0.5.0, requestAnimationFrame observations after page navigation were: first preview **0.60 s**, native single-sample image **2.26 s**, completed adaptive image **4.00 s**. The larger antialiased frame costs more computation. The improvement is immediate cached interaction and progressive detail, not faster completion of a more expensive image.

Raw measurements are preserved as `performance-v0.4.json` and `performance-v0.5.json`. Reproduce with a served build and `python3 tests/browser_benchmark.py`; select Chromium using `CHROMIUM_PATH`. Run releases sequentially on an idle host. Timings are single observations, not statistical or worst-case guarantees.

## Environment and interpretation

Node 24.19.0, Chromium 153.0.8010.0, Playwright 1.57.0 and axe-core 4.11.0. WebGL2 uses ANGLE/SwiftShader, WebGPU uses software Vulkan, and standalone GLES uses llvmpipe. WebGPU is intentionally disabled only in test contexts that independently exercise WebGL2/CPU.

Touch gestures and native-share capability are emulated/stubbed. PNGs are decoded to inspect actual pixels. The CPU preview regression withholds Worker replies after a gesture to expose the previous-camera jump; the old code produced a 245-channel difference, and the repaired code matches the translated image exactly in sampled pixels.

A scratch benchmark wrapper initially lacked its output environment variable and failed before producing a new report. The committed benchmark takes explicit arguments, and the successful final report is the one preserved here. This was a measurement harness error, not an app pass or failure.

## Remote CI and remaining gaps

The workflow runs Node checks, all Chromium suites and Linux WebKit, then uploads browser evidence. Current remote results are added only after the run completes. Historical WebKit evidence from 0.4.0 does not qualify this build.

Public HTTPS, physical iPhone/Safari, physical GPU drivers and a five-hour memory/thermal soak remain unverified. The high-precision renderer still ends at at most 72 horizontal samples. Minimum span `1e-200` and maximum 240 orbit decimal places are unchanged.
