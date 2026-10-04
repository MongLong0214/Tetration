# Validation — 0.4.0

Date: 2026-10-04. Every result is tied to a build hash in `docs/review/v0.4.0/`. Earlier release evidence remains in Git history.

## Local checks

| Suite | Result | Scope |
| --- | --- | --- |
| `npm test` | 65 passed; 0 failed or skipped | Numerical arithmetic, independent finite-orbit references, deterministic CSP/build/server behavior, Worker pixel parity, saved-view validation and product constraints |
| `test:browser` | 29 passed | Map input, finite precision, CSP and mobile emulation |
| `test:release` | 16 passed | WebGL2, context loss, clipboard, exact links and HTTP headers |
| `test:modern` | 12 passed | WebGPU/parallel Workers, 15 reference pixels, completed/partial PNGs and ImageBitmap-unavailable fallback |
| `test:explorer` | 21 passed | Saved coordinates, history, focus, resize drafts, share/storage fallbacks, four viewport sizes and accessibility |
| Software GLES | 8 passed | Production shader compilation/link and stable pixels |

The final counts and pass states are in the adjacent JSON and text evidence. Browser scripts run on a real loopback HTTP origin with the production CSP enabled. No `unsafe-eval`, `unsafe-inline` or CSP bypass is added to make the app pass.

Six axe-core scans reported zero violations. The `color-contrast` rule returned incomplete nodes, so this is not a full accessibility conformance claim. Screenshots and neutral text/background pairs were reviewed separately, including a conservative white image beneath translucent map labels; sampled text contrast was at least 5.58:1. Native focus isolation, keyboard paths and 44px primary targets have separate browser assertions. See `accessibility-review.json` for scope and exclusions.

The reproducible HTML is 88,999 bytes, SHA-256 `11f2747dc69c7700d823d6b693d0bb4e54c472860e98e8901fb996ad4d86de2d`.

## Environment and interpretation

Local runtime: Node 24.19.0; Chromium 153.0.8010.0; Playwright 1.57.0; axe-core 4.11.0. WebGL2 uses ANGLE/SwiftShader; WebGPU uses SwiftShader/Vulkan. Separate GLES uses llvmpipe. These are software drivers.

The WebGPU launch flags explicitly enable software Vulkan. The legacy suite hides WebGPU only inside its test context to independently exercise WebGL2 and CPU fallbacks. The native-share test uses an API stub and does not claim an actual phone share sheet was tested.

Playwright WebKit 26.0 was downloaded locally, but its required GTK/GStreamer system libraries are absent. The GitHub workflow installed these dependencies and completed all 10 WebKit checks. Linux WebKit is not physical Safari.

The numerical tests compare selected finite orbits against independent high-precision references. They do not certify every coordinate, prove convergence or establish a universal error bound.

## Remote CI

[Run 37177991962](https://github.com/MongLong0214/Tetration/actions/runs/37177991962) passed for source commit `21fcd2f01cd8457a29bac6cd18847e4392e40ea7`. The remote build has the same SHA-256 as the locally reviewed build. Node tests and build passed; Chromium 143.0.7499.4 completed 29 + 16 + 12 + 21 checks, and Linux WebKit 26.0 completed 10 checks.

The downloaded browser artifact was verified against SHA-256 `7221b0be78b0752f3836999198dbdea08c43286846c7522d555cc3ad3140a3dd`. Its five JSON reports and WebKit screenshot are preserved under `review/v0.4.0/remote-ci/`, independently of the artifact's seven-day retention. WebKit covered CSP-enabled Worker rendering, mobile layout, keyboard history, native modal focus, coordinate drafts, saved exact views, manual sharing, focus mode and PNG export. No uncaught browser exceptions were reported.

## Reproduce

Follow the commands in the [README](../README.md). Browser output goes to `tests/review-output/`; current review evidence is copied into this directory's `review/v0.4.0/` subdirectory. `SHA256SUMS.txt` records evidence and bundle hashes. CI stores browser artifacts for seven days.

Public HTTPS, physical iPhone/Safari and hardware GPU validation remain separate release conditions.
