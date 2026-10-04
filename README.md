# TETRA

A browser-native tetration explorer. Move through the complex plane, inspect its boundaries, save coordinates and share what you find.

![TETRA explorer](docs/review/v0.5.0/desktop.png)

[![Validate](https://github.com/MongLong0214/Tetration/actions/workflows/ci.yml/badge.svg)](https://github.com/MongLong0214/Tetration/actions)

**0.5.0 · beta release candidate.** Public deployment and device qualification are tracked in the [production review](docs/PRODUCTION_REVIEW.md). The app observes finite iterations; it does not prove convergence or divergence.

## Explore

The map fills the workspace. Open **Explore** for starting points, render settings, precise coordinates and saved views. **Focus** hides the interface. **Share** copies the exact current view, or opens native sharing on supported touch devices. **Export PNG** saves the displayed result and labels incomplete previews.

| Action | Input |
| --- | --- |
| Pan | Drag / arrow keys; Shift + arrow for larger steps |
| Zoom | Scroll / pinch / + and − |
| Zoom into a point | Double-click |
| Overview / starting points | Home / 1–4 |
| Previous / next view | Alt + Left / Right |
| Focus / controls | F / C |
| Saved views / share / PNG | B / S / E |
| Grid / guide | G / ? |

The fractal has three continuous color palettes: **Aurora**, **Ember** and **Tidal**, plus **Mono**. Controls remain neutral. **Detail** resolves the display grid and adds adaptive antialiasing; **Fast** skips the extra edge pass. Try **Bloom**, **Filaments** or **Feather**, then hide the interface with **Focus**.

Optional **Color flow** slowly rotates the displayed hues without moving the camera or recomputing orbits. It starts off, pauses in a hidden tab and stops when the reduced-motion preference changes. Shared links preserve the captured hue and quality setting, but never start animation automatically. Color is an artistic encoding of finite observations, not a proof.

Save up to 24 named views on the current device. Storage is optional: the app remains usable when it is blocked. A shared URL is a separate, portable copy of your coordinates. There is no account or cloud synchronization.

## Run

Node.js 22 or 24; `.nvmrc` selects 24. No npm installation is required to build or run the app.

```bash
npm test
npm run dev
# http://localhost:4173
```

```bash
npm run build       # dist/index.html
npm start          # serve the build locally
```

The development server binds to loopback. Use `HOST=0.0.0.0` only for intentional LAN testing. It is not a public hosting server. There is no file watcher: rebuild after editing. HTTPS hosting is recommended for sharing and graphics features.

## Computation

For each complex base `z`:

```text
w₀ = 1
wₙ₊₁ = exp(wₙ · Log(z))
Arg(z) ∈ (−π, π]; the negative real axis uses +π
```

Zero is excluded. This is finite, integer-height power-tower iteration, not an analytic extension to arbitrary real or complex heights.

| Observation | Interpretation |
| --- | --- |
| Fixed-point candidate | Consecutive values repeatedly approach within a tolerance |
| Period-2 candidate | Values repeatedly approach the value two steps earlier |
| Unresolved | No other stopping condition within the iteration limit |
| Threshold crossed | A condition corresponding to magnitude above 10¹⁰ was observed |
| Numerical limit | Undefined input, overflow, underflow or precision/range constraints |

**No shade proves convergence, periodicity or divergence.** Engines use different numerical tolerances, so boundaries can change between modes.

| Limit | Implementation |
| --- | --- |
| Camera coordinates | 256 decimal places, fixed point |
| Orbit precision | 40–240 decimal places |
| Horizontal span | 1e−200 to 1e12 |
| Each coordinate component | −1e12 to 1e12 |
| Iteration limit | 64, 128, 256, 512 or 1,024 |
| Final deep-view resolution | At most 72 horizontal samples |

Deep views can be slow and visibly coarse. BigInt arithmetic uses truncation, not certified error intervals. Preserving a coordinate is not the same as proving its computed boundary. Infinite precision, unlimited resolution and real-time rendering are not promised.

## Rendering and privacy

- Qualified **WebGPU / WGSL**, then **WebGL2 / GLSL**, provide FP32 images. Five stable reference pixels gate WebGPU initialization.
- GPU images stay in GPU memory. Center-first tiles progressively show a small preview, the display-resolution image, then adaptive four-sample edges. A native one-sample texture is the immutable edge-detection source; flat areas retain their original sample.
- GPU resolution is capped at **8,294,400 pixels**, **2× device density** and **8,192 pixels per dimension**. This can reach a 4K pixel budget; it is not an unlimited-resolution or frame-rate guarantee.
- Dragging repositions the cached image immediately. Orbit work resumes after release; changing views cancels stale results and waits for outstanding GPU work before starting replacement tiles. Reprojection does not create new mathematical detail.
- A pool of **1–4 Workers** handles FP64 and high precision. FP64 final grids use at most 1.6 million samples / 2,048 across. Deep-view limits remain unchanged: at most 72 across, with smooth display interpolation rather than invented detail.
- **OffscreenCanvas / ImageBitmap** transfers Worker tiles where supported; transferable pixel buffers remain the fallback. PNG export snapshots the GPU once and preserves the captured camera, hue, grid and completion label.
- No framework, runtime npm dependency, external computation API, analytics script or login. Saved views are written only after an explicit save/remove action. Hosting access logs are separate from the app.

A controlled software-GPU run found smoother drag response, but the larger antialiased image takes longer to finish than 0.4.0. See [measured results and limitations](docs/VALIDATION.md). Five-hour sessions, physical GPU performance and mobile thermal behavior have not been qualified.

The build hashes exact script and stylesheet bytes into its CSP. It does not permit `unsafe-inline` or `unsafe-eval`. `connect-src 'none'` blocks app fetches; Workers are limited to blob URLs. Do not modify the built inline code without rebuilding.

## Deploy

Import **MongLong0214/Tetration** into Vercel with the committed configuration:

| Setting | Value |
| --- | --- |
| Framework | Other |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `echo No dependencies` |
| Environment variables | None |

`vercel.json` includes anti-framing, MIME sniffing, referrer, permissions and cache headers. The HTML contains the script/style CSP. Other hosts must supply equivalent response headers. URL fragments carry the view; no server route rewrite is needed.

The connected Vercel account currently rejects the intended team scope with HTTP 403. See [publication status](docs/PUBLISHING.md) for the actual deployment result. No live URL is claimed until HTTPS verification succeeds.

## Verify

```bash
npm test
npm run build
python3 -m pip install -r tests/requirements.txt
npm install --no-save --package-lock=false --ignore-scripts axe-core@4.11.0
python3 -m playwright install --with-deps chromium webkit
# Start npm start in another terminal, then:
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:browser
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:release
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:modern
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:quality
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:explorer
TETRA_BASE_URL=http://127.0.0.1:4173 npm run test:webkit
```

`CHROMIUM_PATH` selects an existing Chromium executable. `AXE_CORE_PATH` selects an existing axe-core script. These are test-only tools. The app does not ship them. GitHub Actions runs the checks on a served origin and preserves browser evidence for seven days.

See [validation evidence](docs/VALIDATION.md), [production review](docs/PRODUCTION_REVIEW.md) and [changelog](CHANGELOG.md). Linux software graphics, mobile emulation and Playwright WebKit are not physical GPU or iPhone/Safari qualification.

## Structure

| Path | Purpose |
| --- | --- |
| `src/main.js` | Camera, input, navigation, orchestration and export |
| `src/core.js`, `src/precision.js` | Finite orbit classification and numerical arithmetic |
| `src/gpu.js`, `src/webgpu.js`, `src/render.js` | GPU frames, progressive sampling and display utilities |
| `src/worker.js`, `src/saved.js` | Parallel tiles and validated local saved views |
| `src/index.html`, `src/style.css` | English neutral interface around the colored map |
| `tests/` | Numerical references and browser regression suites |
| `docs/review/v0.5.0/` | Current review evidence |

Report bugs with a shared view URL, device/browser, iteration limit and precision mode. Numerical changes should include a reproducible case and independent reference values.

No license has been added or changed. The repository owner selects the license. `private: true` prevents npm publication; it does not make this GitHub repository private.
