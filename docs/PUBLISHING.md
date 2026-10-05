# Publication and deployment

Target: [MongLong0214/Tetration](https://github.com/MongLong0214/Tetration), public, default branch `main`.

## 2026-10-06 performance qualification

Qualified code head: `a5fb110`, product runtime SHA-256 `416ff519e6ab9bb19a6f69419399c3accb350c61992ea60f765eb57d6166faf3` (267,387 bytes). The [full CI qualification](https://github.com/MongLong0214/Tetration/actions/runs/37372511644/attempts/2) passed 137 units/lint/build and all 17 browser suites. Local frozen-build verification passed 281 checks plus four actual Ultra-cancel/navigation/cache-upgrade checks. See [VALIDATION.md](VALIDATION.md) for the retained failures, retries and platform limits.

Delivery uses a fast-forward of `main` and the existing Vercel Git integration. Public verification must use the runtime hash above, actual security headers and asset bytes, then repeat native zoom, release, explorer and deep Ultra-cancellation/cache-upgrade scenarios on the public domain. The pre-delivery public HTML hash `586d350ae2e452cceb14e9dd557c219e0f4f1dba5013a1deed628e67dabcabef` is the historical performance baseline, not the qualified runtime. The network restrictions described below applied to the original October 4 review.

## Historical 1.0.0 delivery (2026-10-04)

Developed on branch `claude/hopeful-newton-sdzsh3` from `main` at `2cfce5b` (0.5.0 with recorded CI evidence). Existing commits are preserved. The build output is `dist/index.html` plus the offline shell (`sw.js`, `manifest.webmanifest`, three PNG icons); its hash and sizes are recorded in [VALIDATION.md](VALIDATION.md).

Only this repository is in scope. No license or repository visibility change is made.

## Vercel deployment

Production: **https://tetration.vercel.app**, Vercel project `tetration` (personal scope `monglong0214s-projects`), connected to this repository: every push to `main` deploys to production and other branches get preview deployments. Settings: framework Other, build `npm run build`, output `dist`, install `echo No dependencies`, Node 24. The first production deployment (`dpl_9V11ePpU22dbhSt3AfQ1Bg3jx8BV`) built `main` at `27c82a9` and reached READY.

Vercel Authentication (standard protection) covers preview and per-deployment URLs; the production domain is public. Link previews use absolute URLs from `SITE_URL` (default `https://tetration.vercel.app`).

At the original review, served bytes and headers could not be fetched from that workspace because its network policy blocked the domain. That historical review did not verify public HTTPS headers, rendering or offline reload. Credentials and private tokens must not be placed in chat or committed.
