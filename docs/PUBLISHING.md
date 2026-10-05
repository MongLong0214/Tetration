# Publication and deployment

Target: [MongLong0214/Tetration](https://github.com/MongLong0214/Tetration), public, default branch `main`.

## 1.0.0 delivery

Developed on branch `claude/hopeful-newton-sdzsh3` from `main` at `2cfce5b` (0.5.0 with recorded CI evidence). Existing commits are preserved. The build output is `dist/index.html` plus the offline shell (`sw.js`, `manifest.webmanifest`, three PNG icons); its hash and sizes are recorded in [VALIDATION.md](VALIDATION.md).

Only this repository is in scope. No license or repository visibility change is made.

## Vercel deployment

Production: **https://tetration.vercel.app**, Vercel project `tetration` (personal scope `monglong0214s-projects`), connected to this repository: every push to `main` deploys to production and other branches get preview deployments. Settings: framework Other, build `npm run build`, output `dist`, install `echo No dependencies`, Node 24. The first production deployment (`dpl_9V11ePpU22dbhSt3AfQ1Bg3jx8BV`) built `main` at `27c82a9` and reached READY.

Vercel Authentication (standard protection) covers preview and per-deployment URLs; the production domain is public. Link previews use absolute URLs from `SITE_URL` (default `https://tetration.vercel.app`).

The served bytes and headers could not be fetched from the review workspace (its network policy blocks the domain), so they still need one check from a normal browser: the page renders, `curl -I https://tetration.vercel.app/` shows the CSP and `vercel.json` headers, and the app reloads offline after one visit. Credentials and private tokens must not be placed in chat or committed.
