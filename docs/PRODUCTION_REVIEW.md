# Production review — TETRA 0.4.0

Review date: 2026-10-04. **Beta release candidate; unrestricted commercial readiness is not yet approved.** The remaining deployment and physical-device gaps are explicit below.

## Scope

Reviewed the complete path: open the map → pan/zoom → select a starting point or exact coordinate → change precision → save/reopen → share/reopen → export. Also reviewed cancellation, graphics failure, unavailable storage/clipboard, keyboard access, small viewports, CSP, build determinism and repository delivery.

The work continues the reviewed 0.2.0 archive and published 0.3.0 app. There is no framework migration or backend. The only change inside `core.js` is the grayscale color function. The orbit classifiers and `precision.js` remain unchanged.

## Product changes

- Edge-to-edge monochrome map. Controls live in a native modal panel; focus mode removes the surrounding interface.
- English UI, errors, guidance, current README and review documents.
- Three achromatic shading modes, forward/back history, direct keyboard commands and optional local saved views.
- Exact-coordinate sharing with native touch-device sharing, clipboard and manual-copy paths.
- Bounded interactive GPU previews. WebGPU final-image snapshots use an asynchronous ImageBitmap path; moving cancels old work.
- No runtime dependency, analytics, account, external computation service, paid integration or license change.

## Defects found and fixed

| Finding | Fix | Regression evidence |
| --- | --- | --- |
| A long controls dialog could extend beyond the viewport without usable scrolling | Explicit viewport-bounded dialog height and internal scrolling | Coordinate submit and all primary controls at four viewport sizes |
| A keyboard-like viewport resize replaced an unfinished coordinate with the current camera value | Preserve coordinate drafts until successful submission or panel closure | Exact decimal draft survives resize and submits |
| WebGPU preview snapshots forced extra image work during navigation | Skip preview snapshots; asynchronously preserve final frames | WebGPU rendering, cancellation and exported pixel checks |
| An export in progress could label a different camera state after navigation | Freeze view, iteration limit, completion state and grid at export initiation | Start a partial WebGPU export, immediately navigate, then check actual PNG pixels and captured metadata |
| Previous interface occupied map space and used mixed color palettes | Closed-by-default controls and neutral luminance shading | Screenshots, layout assertions and CPU/GPU reference pixels |

## Verification

Current local and remote results are listed in [VALIDATION.md](VALIDATION.md). Automated accessibility checks are supporting evidence, not a claim of full WCAG conformance. Items marked incomplete by the checker require manual interpretation; keyboard reachability, focus handling and primary target sizes are separately exercised.

Graphics checks use software drivers. Startup, render and deep-view timings depend on the sampled view and test machine. They are not hardware benchmarks or worst-case guarantees. The app stays navigable during Worker computation and rejects stale results after navigation.

## Numerical limits

Finite observations only. Threshold crossing does not prove divergence. Fixed-point and period-2 classifications are candidates. Minimum span is `1e-200`; high-precision orbits use at most 240 decimal places; deep final passes have at most 72 horizontal samples. Engine transitions are heuristics, not proven error bounds. The arithmetic is not interval-certified.

## Release conditions

| Area | Status |
| --- | --- |
| English monochrome product, bounded navigation and sharing | Implemented; browser evidence recorded |
| Local numerical, CSP, graphics and interaction checks | See validation evidence |
| Current GitHub source and CI | See [publication record](PUBLISHING.md) |
| Public Vercel HTTPS | Blocked by team-scope HTTP 403 until the connection is authorized |
| Linux WebKit | 10 checks passed in remote CI on WebKit 26.0; mobile viewport emulation, CPU path |
| Physical iPhone/Safari | Not tested |
| Hardware GPU and sustained mobile memory/thermal behavior | Not tested |

Public HTTPS verification must confirm the deployed bytes, security headers, Worker execution, exact link sharing and PNG export. Physical Safari must verify actual pinch gestures, OS sharing, download behavior, safe-area layout and background recovery. Those checks are not replaced by desktop emulation.
