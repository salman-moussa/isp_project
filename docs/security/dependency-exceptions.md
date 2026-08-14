# Dependency exception register

## Expo/Metro `image-size` denial of service

Status: time-bounded, non-runtime build-tool exception. Expires 2026-09-15.

GitHub published two high-severity `image-size` infinite-loop advisories in June 2026:
`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`. As of 2026-08-13, GitHub lists every released
version through 2.0.2 as affected and lists no patched version. Expo SDK 57 / Metro uses
`image-size` during the Node-based native bundle build. The package is not part of the Orvex ISP
API, workers, web runtime, or the installed React Native application binary, and Orvex does not
expose a Metro development server or accept attacker-supplied images into a release build.

`scripts/security/audit-production.mjs` still runs npm's complete production audit and fails every
critical/high issue except the exact two advisory URLs when npm proves they propagate solely from
`image-size` through the Metro dependency graph. New advisories, another affected root, a changed
dependency path, or the expiry date fail closed. Release owners must update Expo/Metro immediately
when an upstream patched version exists, then delete this exception.

The exception does not waive runtime upload controls, malware/type inspection, image dimension
limits, decompression limits, or staging DAST. Those remain separate release gates.
