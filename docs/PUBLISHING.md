# Publication and deployment

Target: [MongLong0214/Tetration](https://github.com/MongLong0214/Tetration), public, default branch `main`.

## Baseline

The redesign starts at `1a02544f752fe5d0091f16111639a4a963f1186a`. That commit and its remote CI passed in the previous release.

- [Source commit 21fcd2f](https://github.com/MongLong0214/Tetration/commit/21fcd2f01cd8457a29bac6cd18847e4392e40ea7)
- [PR #2](https://github.com/MongLong0214/Tetration/pull/2), merged after the browser workflow passed
- [Merge commit 0e7ced6](https://github.com/MongLong0214/Tetration/commit/0e7ced65cead4618d66bec6fe27f17bbfb3e4aad)
- [Successful source CI](https://github.com/MongLong0214/Tetration/actions/runs/37177991962), including Linux WebKit

All 62 initial publication paths, file modes and Git blob hashes were compared against a fresh remote fetch, including nine binary images and the workflow. The follow-up documentation records actual CI results and preserves the downloaded browser evidence. The HTML is unchanged: 88,999 bytes, SHA-256 `11f2747dc69c7700d823d6b693d0bb4e54c472860e98e8901fb996ad4d86de2d`.

Existing commit history is preserved. Only this repository is modified. Obsolete prototype screenshots, previous review bundles and the first-publication helper were removed from the current tree; their prior versions remain in Git history. Current product documentation is English.

## Vercel access

The connected account's default team is `monglong0214s-projects`. A fresh project lookup returned **403 Forbidden** on 2026-10-04. Vercel's response requires re-authenticating to this team scope or a connection authorized for that scope. Team enumeration returned no available teams. No authenticated local Vercel CLI or token is available.

The deployable configuration is committed in `vercel.json`. No existing Vercel project or domain was changed. No production URL, successful deployment or public HTTPS validation is claimed while access is blocked.

After access is restored, deploy this repository with its existing build configuration, confirm the production target and inspect the real HTTPS response and browser behavior. Account credentials or private tokens should not be placed in chat or committed to the repository.
