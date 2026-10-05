# Performance probes

Measurement tools for deep-zoom performance work (see `docs/HANDOFF_PERFORMANCE.md`). They are not
part of the test suites and assert nothing; they print one JSON line per view.

| Script | Needs | Measures |
| --- | --- | --- |
| `orbit_work.cjs` | Node only | Per-pixel classes, step quantiles, loop iterations per pixel without and with BLA (FP64 perturbation, GPU rules) |
| `gpu_kernel.py` | Served build, Playwright | Production shader time for one 1-sample draw per view, without app scheduling |
| `app_timeline.py` | Served build, Playwright | Fresh-load render: reference, every GPU submission, first perturbation draw (includes lazy shader compile), total |

```sh
npm run build && node serve.cjs dist &        # http://127.0.0.1:4173
node tools/perf/orbit_work.cjs plume abyss horizon
python3 tools/perf/gpu_kernel.py --size 240x118
python3 tools/perf/app_timeline.py --viewport 480x320 plume deep200
```

A/B comparison of two commits: build each in a git worktree and serve it on its own port
(`PORT=4174 node serve.cjs <worktree>/dist`), then pass `--port`. Views live in `views.json`.
SwiftShader timings vary by about ±10% between runs; repeat and interleave A/B runs.
