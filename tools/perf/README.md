# Performance probes

Measurement tools for deep-zoom performance work (see `docs/HANDOFF_PERFORMANCE.md`). They are not
part of the test suites and assert nothing; they print one JSON line per view.

| Script | Needs | Measures |
| --- | --- | --- |
| `orbit_work.cjs` | Node only | Per-pixel classes, step quantiles, loop iterations per pixel without and with BLA (FP64 perturbation, GPU rules) |
| `gpu_kernel.py` | Served build, Playwright | Production shader time for one 1-sample draw per view, without app scheduling |
| `app_timeline.py` | Served build, Playwright | Fresh-load render: reference, every GPU submission, first perturbation draw (includes lazy shader compile), total |
| `exploration.py` | Served build, Playwright | Alternating real-app A/B runs: opening a page, Ultra completion, native pan reuse, Retina dragging, presentation gaps and actual graphics renderer |

```sh
npm run build && node serve.cjs dist &        # http://127.0.0.1:4173
node tools/perf/orbit_work.cjs plume abyss horizon
python3 tools/perf/gpu_kernel.py --size 240x118
python3 tools/perf/app_timeline.py --viewport 480x320 plume deep200
```

A/B comparison of two commits: build each in a git worktree and serve it on its own port
(`PORT=4174 node serve.cjs <worktree>/dist`), then pass `--port`. Views live in `views.json`.
SwiftShader timings vary by about ±10% between runs; repeat and interleave A/B runs.

To compare exploration on the same origin, serve the candidate and pass the original built HTML:

```sh
python3 tools/perf/exploration.py --port 4173 --repeat 3 \
  --baseline-html /path/to/original/dist/index.html --output /tmp/exploration-ab.json
```

The original HTML response is intercepted unchanged and service workers are blocked. Network
timing is excluded. `first_render_ms` is the app's render interval; `page_to_complete_ms` also
includes initialization. `release_to_complete_ms` uses an in-page pointer release timestamp
and a mutation observer on the app's completion flag, including settling after a pan.
`wait_to_complete_ms` separately records the automation driver's wait, which can be much
longer because of locator polling. Do not compare older driver-wait measurements to the
new in-page timestamps as if their difference were a product improvement. The tool
records every run, medians, graphics/browser identity, bundle hashes and errors. Use
`--scenario cold` or `--scenario pan retina_drag` for selected workloads; run GPU comparisons
sequentially without other graphics tests. See [the analysis](../../docs/PERFORMANCE_RESEARCH.md)
for the measured conditions and remaining limits.
