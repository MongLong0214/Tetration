# Publication and deployment

Target: [MongLong0214/Tetration](https://github.com/MongLong0214/Tetration), public, default branch `main`.

## 0.5.0 delivery

Baseline: `4b16c005c635ac73ee0f11019524e8e1d68f5f4c`. Existing commits are preserved. The new source and review evidence are published through a normal branch/PR. Remote commit, CI and byte-comparison results are added after actual responses, not assumed in advance.

Only this repository is in scope. README images, regression scripts and the GitHub workflow are included. No license or repository visibility change is made.

## Vercel access

A fresh project lookup for this repository under `monglong0214s-projects` returned **403 Forbidden** on 2026-10-04. The response requires re-authentication to the intended team scope. The cloud browser opened Vercel but had no signed-in session.

The user reported installing Vercel CLI on their local machine. The separate execution workspace still has no `vercel` executable on PATH or common install paths, no Vercel CLI login file, and no `VERCEL_TOKEN` environment value. This does not say whether the user's own installation is working; that machine is not available to the executor.

`vercel.json` contains the static deployment settings. No existing Vercel project or domain has been changed. No successful deployment or public HTTPS verification is claimed while authenticated access is unavailable. Credentials and private tokens must not be placed in chat or committed.
