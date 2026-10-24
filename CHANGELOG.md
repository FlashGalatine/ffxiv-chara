# Changelog

## 0.1.0-beta.4 — 2026-10-24 (prepared; not published)

Changes since the published `0.1.0-beta.3`. `AppearancePolicy.version` is now the literal `'1.1.0'`: `'1.0.0'` is no longer a member of the type, so code that compares or switches on `'1.0.0'` stops compiling. `AppearanceReason` gains `lipDisabled`, which an exhaustive switch must handle.

- Appearance policy `1.1.0`: read bit `0x80` of `Mouth` as the lip-color enable that Anamnesis, Ktisis and Brio all use. A cleared bit now reports the lip as inactive with the new reason `lipDisabled`, where `1.0.0` treated every lip index as enabled. The `AppearancePolicy.version` literal type is now `'1.1.0'`. An absent, null or invalid `Mouth` leaves lip activity unknown. Hrothgar ignores the bit; with an unknown race the lip is active only when the bit is set and unknown otherwise. Also treat bit `0x80` of `FacePaint` as the mirror flag it is in Brio and Ktisis: `FacePaint` 128 (no paint, mirrored) is now inactive instead of showing a face-paint swatch; every value with a non-zero low seven bits is unchanged. Consumers that switch exhaustively on `AppearanceReason` must handle `lipDisabled`.
- Add an `EYE_PAIRING_UNCONFIRMED` warning when one eye's extended color lands on the opposite eye's shader color but a custom color on the other eye hides the second match (Brio v0.7.2+ stores the two eye colors crossed). Colors are not swapped in that case. With `historicalEyeCorrection: false` a fully crossed pair, which every current Brio export is, now carries the same warning (the colors are not swapped either); beta.3 reported nothing. Document the Brio crossing and pin the reviewed producer sources in the fixture manifest.
- Pin the corrections, per-eye swatches and lip state of the four real producer exports in regression tests.
- XIVAPI: a Stain or Glasses row that the API reports as missing no longer fails the whole lookup. XIVAPI answers a row list that names a missing row with a 404 for the whole request; the client now recognises exactly that answer for the requested sheet, drops the row and asks again for the rest, at most one request per missing row inside the 40-request budget. A missing Glasses row resolves to `notFound`; every other 404 is still a failure.
- XIVAPI: `createDyeNameResolver` reads inherited and non-enumerable options as `createXivapiClient` does instead of silently falling back to defaults; a browser's opaque redirect is reported as `REDIRECT_REFUSED`; a cached entry whose rows are out of order is a miss; host cache calls are capped at the request timeout and a slow or hung cache write can no longer lower a complete result; an all-zero off-hand no longer pairs with a main hand.
- Input from another realm (an iframe, a `vm` context, a test environment): `readChara` accepts a real `Uint8Array` created there, and response body chunks from there no longer make every XIVAPI lookup `BODY_UNAVAILABLE`. The check reads the typed-array brand instead of using `instanceof`, so it cannot be spoofed; an object that only inherits `Uint8Array.prototype` is now `INVALID_INPUT` instead of a raw `TypeError`, a view whose buffer was transferred away is `INVALID_INPUT` instead of `INVALID_JSON`, and own properties that shadow `byteLength` or `buffer` on a real `Uint8Array` are ignored.
- XIVAPI signals: `createXivapiResolver().resolve`, `searchItems`, `getGlasses` and `getStains` (and so `createDyeNameResolver`) now share one check: `undefined` or an `AbortSignal`-compatible object, from any realm. An invalid `signal` (including `null`, an object whose members throw when read, or one that cannot register its listener) throws `INVALID_LOOKUP` instead of a raw `TypeError`, and no longer leaves an orphaned subscriber that keeps a shared request alive. A `null` signal that the low-level client used to ignore is now rejected.
- Inspection: an integer outside 0-255 in `Race`, `Tribe`, `Gender`, `Age` or `FacialFeatures` is now `invalid` (`INVALID_FIELD`) instead of `unsupported`, since these are bytes in the producers' files; a string or 0-255 that is not a known value stays `unsupported`. When the reader truncated its diagnostics, the single `ISSUES_TRUNCATED` marker is now the final entry of `inspection.issues` instead of sitting in the middle of the list. `resolve()` reads `glassesId` once.
- XIVAPI: a `Retry-After` value is waited for only when it is delay-seconds (digits with an optional fraction) or an HTTP date in the IMF-fixdate form, at most two seconds away; any other form (a sign such as `-1` or `+1`, a trailing point, an ISO or RFC 850 or asctime date, a unit) is now `RETRY_LIMIT`. Before, `Date.parse` decided, and it reads `-1`, `+1` and `1.` as 1 January 2001 in V8 and differently elsewhere.
- XIVAPI: `createXivapiClient`, `createXivapiResolver` and `createDyeNameResolver` read each option once and treat an option whose getter throws as `INVALID_OPTIONS`; before, the raw error escaped from `createDyeNameResolver` for every option and from the other two for every option but `baseUrl`. The same goes for what two options hold: a `languages` list is copied by index after a length check of 1 to 4, so an element or length that throws is `INVALID_OPTIONS`, and a list with a hole, which beta.3 accepted (the hole became a language `undefined`), is now `INVALID_OPTIONS` too; the cache's `get` and `set` are read once when the client is created and called on the cache, so replacing them afterwards has no effect (a cache without both methods was already `INVALID_OPTIONS`).
- Compatibility record (2026-10-24): Anamnesis never writes `IsExtendedAppearanceValid` and Ktisis writes no extended colors, so extended features apply only to Brio-shaped files; the Anamnesis embedded-image limit that can pass the 8 MiB read budget; none of the current Anamnesis, Ktisis and Brio offers a selective export; thirteen more upstream files are pinned (metadata and image fields, vector and color formats, enum names, the Ktisis writer, Brio vector converters, and the three files that the stated producer limits rest on); the refresh method now compares meaning as well as bytes. The demo says why a file over its size limit was refused.
- Docs: on Cloudflare Workers create the client or resolver per request and share only the cache. A module-scope client hung a queued lookup under workerd, and a later lookup on the same isolate then failed with `DEADLINE` because the scheduler slots were never released.

## 0.1.0-beta.3 — 2026-10-22

- Normalize legacy tribe `Helion` to `Helions` while preserving stored evidence, Hrothgar race derivation and palette interpretation. Keep numeric tribe IDs unchanged. This fix is not included in published beta.2.
- Refresh official Anamnesis, Ktisis and Brio release/export/serialization references and record their unchanged format contracts.
- Configure manual demo deployment to `charakit.projectgalatine.com` with shared generated security headers, a `no-transform` response policy and Cloudflare hosting checks in CI.
- Record the verified initial demo deployment and draft the separate XIV Dye Tools integration plan.
- Prepare beta.3 metadata and manual publication instructions with the existing `next` tag and protected approval workflow.

## 0.1.0-beta.2 — 2026-10-22

- Publish through the existing manual GitHub Actions workflow, using `next`, protected environment approval and verified trusted-publisher provenance.
- Update release metadata, package documentation and dispatch instructions.
- No library API, runtime behavior, palette data or dependency changes from beta.1.

## 0.1.0-beta.1 — 2026-10-21

- Replace the bundled English dye-name snapshot with optional cached XIVAPI Stain-name requests. Preserve local parsing/raw IDs and require explicit demo lookup. Remove the unpublished synchronous name/metadata API and snapshot-generation commands.

- Prepare `xivcharakit@0.1.0-beta.1` for `next`, with a package README and manual, dry-run-by-default publishing workflow that checks and publishes the same tarball.

- Adopt the XIVCharaKit identity, `xivcharakit` package imports and demo branding; rename the GitHub repository to `FlashGalatine/XIVCharaKit`.

- License original code under MIT and include Square Enix attribution/non-affiliation notices in the README, demo and distributed legal files.

- Read and inspect full or selectively saved Anamnesis, Ktisis and Brio character documents with bounded parsing and embedded-image omission.
- Preserve stored values alongside identity, equipment, independent dye channels, facewear and diagnostics.
- Interpret appearance swatches with source-labelled creator, shader and extended colors, using versioned palette provenance.
- Retain stored dye IDs locally, including unknown/missing states; resolve English names through optional cached XIVAPI requests.
- Offer optional bounded XIVAPI equipment candidate and facewear lookup, including ambiguity, partial results, cancellation and caching.
- Provide a local reference demo with worker-based inspection, explicit equipment lookup and keyboard/mobile support.
- Check installed package consumers across Node, Node Worker, Chromium, module Web Worker and local workerd; prepare CI and reviewed package/static-site artifacts.

The maintainer published `xivcharakit@0.1.0-beta.1` through the bootstrap process; its tarball matched the reviewed candidate. Only the library is published; the root and demo workspaces remain private, and the website has not been deployed. MIT covers original code; game-derived materials retain separate notices and provenance.
