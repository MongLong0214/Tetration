# Publication and deployment

Target: [MongLong0214/Tetration](https://github.com/MongLong0214/Tetration), public, default branch `main`.

## 1.0.0 delivery

Developed on branch `claude/hopeful-newton-sdzsh3` from `main` at `2cfce5b` (0.5.0 with recorded CI evidence). Existing commits are preserved. The build output is `dist/index.html` plus the offline shell (`sw.js`, `manifest.webmanifest`, three PNG icons); its hash and sizes are recorded in [VALIDATION.md](VALIDATION.md).

Only this repository is in scope. No license or repository visibility change is made.

## Vercel access

The 0.5.0 review recorded that a project lookup for this repository under `monglong0214s-projects` returned **403 Forbidden** and that the execution workspace had no Vercel CLI login or token. The 1.0.0 workspace also has no Vercel credentials, so no deployment was attempted.

`vercel.json` contains the static deployment settings and headers; the service worker needs no extra configuration on Vercel, which serves `.js` and `.webmanifest` with the correct types. No existing Vercel project or domain has been changed. No successful deployment or public HTTPS verification is claimed. Credentials and private tokens must not be placed in chat or committed.
