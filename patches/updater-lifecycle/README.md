# ATS updater lifecycle patch

`patch.json` is the reproducible delta for PATCH-01, applied to the original
lock-resolved `electron-updater@6.8.10` and `builder-util-runtime@9.7.0` packages.
Package versions, npm tarball provenance, lock integrity and licenses are retained.
It changes four compiled files; no vendored updater or differential algorithm is copied.

`npm ci` runs `scripts/apply-updater-patches.cjs` before native dependency setup.
The script preflights versions, original SHA-256, exact replacement contexts and
unmodified integration seams before writing. Already patched files are verified
idempotently. Unknown versions/content fail with a nonzero exit. Run
`node scripts/apply-updater-patches.cjs --check` to verify without writing.
Unsigned packaging requires this verification. Runtime verification uses the
same manifest; a mismatch disables remote updater setup while local POS starts.
The declaration file is verified during installation. Electron Builder excludes
dependency `.d.ts` files; runtime verification covers all three patched executable
JavaScript files and the unchanged integration seams. This is an explicit type
declaration boundary, not an optional executable integrity check.

The native cache helper receives the download's token, hashes every byte with
SHA-512, and uses an abortable Node pipeline to close its input and digest before
returning. State publication is checked after asynchronous cache-info writing.
AppUpdater passes the same token through validation, publication and rename retry.
Its rename task uses a single `fs.promises.rename` call: `fs-extra.rename` has an
additional Windows retry inside graceful-fs, outside the token-aware retry.
The existing 60-attempt policy belongs solely to the cancelable native retry.
Native helper cleanup, cache layout and promotion paths remain authoritative.

Original source maps are retained as package provenance, and do not describe
inserted compiled lines. Review the before/after contexts and verified compiled
bytes, rather than trusting map line locations for patched functions.

An upgrade must explicitly regenerate/review this delta, audit the unchanged
seams, rerun original-negative and corrected-positive lifecycle fixtures, prove
clean `npm ci`, and inspect/test the final ASAR. Hash/version failures are gates,
not permission to fall back to unpatched behavior. See
[implementation contract](../../docs/rc-2b-3/gate-5-0-patch-01-implementation.md).
