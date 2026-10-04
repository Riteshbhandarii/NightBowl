# Dependency security and CMS caching

## Reviewed dependency changes

The 2026-10-04 audit of `a3e6216` reports four affected package entries (three
high, one moderate). The earlier nine-entry count in #87 is historical.
Only these lockfile entries changed; direct framework versions and their
declared ranges remain unchanged:

| Package | Before | Reviewed version |
|---|---|---|
| brace-expansion | 5.0.9 | 5.0.12 |
| devalue | 5.9.2 | 5.9.4 |
| fast-uri | 3.1.7 | 3.1.8 |
| http-cache-semantics | 4.2.0 | 4.3.0 |

`npm ci` and `npm audit --json` report zero known vulnerabilities with this
lockfile at review time. This is not a guarantee against unknown vulnerabilities.
No forced audit fix, framework downgrade, override or advisory exclusion is used.

`npm run check:security` tests all locked copies against these reviewed version
floors and exercises three actual regressions: pooled Buffer serialization,
percent-encoded hostname equality and deeply nested brace parsing. All three
behavior probes fail on the previous dependencies. For a two-byte Buffer view,
the old `devalue` serialized the entire backing pool rather than just two bytes.
Tests report lengths, not the unrelated memory contents.

CI runs `npm audit --audit-level=moderate` and the offline behavior checks before
building. A new advisory or changed dependency graph requires review; do not
silence the gate or downgrade Astro to make it green.

## The cache advisory needs a separate conclusion

[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
lists versions through 4.2.0, but does not name a patched release. The
[maintainer disputes the report](https://github.com/kornelski/http-cache-semantics/issues/56).
The reviewed 4.3.0 still permits the reported `max-stale` reuse when a caller
retains a zero-lifetime entry and asks only `satisfiesWithoutRevalidation`.
Therefore, **zero audit output is not evidence that this behavior was patched**.

In NightBowl's installed Astro, the importer is
`astro/dist/assets/build/remote.js`: it fetches a remote image, checks
`policy.storable()` and computes its TTL. Revalidation creates its own request
with `cache: 'no-cache'`. Neither path calls `satisfiesWithoutRevalidation` or
forwards a visitor's `max-stale` header. Current content does not use Astro's
remote-image API. `scripts/serve.mjs` compresses responses; it does not store a
shared response cache. There is no custom response cache in the app.

These inspected paths do not expose the advisory's cross-user shared-cache
scenario. Reassess this conclusion if adding remote images, a response cache,
authenticated SSR data or a caching proxy. Never use a zero TTL or a Set-Cookie
header alone as a privacy policy; intermediary caching still needs correct
directives and deployment review.

## CMS response policy

Every response in `/api/keystatic` is marked `Cache-Control: private, no-store`,
including auth redirects, logout cookies and API errors. Middleware preserves
status, Location and the separate access/refresh cookie expirations. Ordinary
pages and public asset caching are unchanged. This is defense in depth, not a
claim that the old site was compromised.

The CMS suite checks both fresh requests and requests carrying `max-stale`, in
production and local development. Production checks still verify GitHub-mode
authentication and the absence of local-file edit access. CI credentials are
fake; these checks do not prove a real GitHub App or deployment is configured.

Any eventual CDN/host must honor the no-store policy and must not cache these
APIs. Verify that on the selected production host before launch (#106).
