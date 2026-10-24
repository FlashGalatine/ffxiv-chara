# Remediation plan: code-review audit of 2026-10-23

**Source:** [audit-2026-10-23.md](audit-2026-10-23.md), the audit of `014c6a0` (106 findings: 2 high, 28 medium, 76 low; 8 verifier disputes resolved by the maintainer, see its §7). Plus one finding added during the fixes (N001, FacePaint mirror flag).

**Status basis:** 107 findings in all. Fixed and committed: F096, F092, N001 (Wave 0), the eight Wave 1 documents, the seven Wave 2 findings, the seven Wave 3 findings, the ten Wave 4 findings, the eight Wave 5 findings, the eight Wave 6 findings, the eleven Wave 7 findings, the fifteen Wave 8 findings, the fourteen Wave 9 findings, the eight Wave 10 findings and the seven Wave 11 findings, 106 in all. Partly fixed: F090 (warning only). Outstanding: 0. Nothing is published or deployed. Superseded: 0. Not scheduled (register below): 5 ruled info or no-defect, 2 refuted, 22 unverified observations.

**Ordering:**
1. One deploy unit per wave, each ending in a named gate or release. Waves are the equivalent of the sprints in the XIV Dye Tools remediation plans.
2. Behaviour before evidence: wrong output on real input first (Wave 0, then 2-3), the tests that pin it after, so tests describe the corrected code.
3. Documents that misstate the current state go first because they are cheap and ship nothing (Wave 1); documents that describe new behaviour ride with the wave that changes it.
4. Test-only waves (7-10) ship nothing; they follow the behaviour waves and each new assertion must be shown to fail against the weakened control.
5. There is no P0. P1 is wrong output on valid input; P2 is degraded but contained (every medium, including security-gate test gaps); P3 is the rest.

## Wave overview

| Wave | Unit | Theme | H / M / L | Status |
|---|---|---|---|---|
| 0 | packages/chara (appearance) | Done in this session | 2 / 0 / 1 + N001 | ✅ done (04fbeff) |
| 1 | docs only | Documents that misstate the current state | 0 / 1 / 7 | ✅ done (5a4a6e9, 614ac34, 8d0d0b2, 0cd9f7f) |
| 2 | packages/chara (xivapi) | The client was written against doubles that are not the real API | 0 / 3 / 4 | ✅ done (8959fc1, b20624f, e8cf5f9, ed0589a, ab358b0, b83c9de, dbf5b62, bdd1cbc, 298bd32) |
| 3 | packages/chara (reader, inspect, xivapi) | Cross-realm input, re-read values, label accuracy; then publish | 0 / 0 / 7 | ✅ done (e965238, 60717a5, 7c49ade, d217c44) |
| 4 | repo tooling (scripts, test/, CI) | Release and verification tooling that can pass vacuously | 0 / 1 / 9 | ✅ done (27d3c5e to 3fbe8a7) |
| 5 | apps/demo | State, focus and live-region fragility across re-renders | 0 / 2 / 6 | ✅ done (e8be1fd to e4bc6e7) |
| 6 | apps/demo (tests) | Evidence for the privacy and CSP gates (THREAT_MODEL SEC-03) | 0 / 4 / 4 | ✅ done (5d5574e to ba6353d) |
| 7 | packages/chara (tests) | Reader and inspection guards that can be deleted unnoticed | 0 / 4 / 7 | ✅ done (8a1b3fd to 726a01b) |
| 8 | packages/chara (tests) | Appearance maths and palette provider assertions | 0 / 6 / 9 | ✅ done (d5d064e to 0defad7) |
| 9 | packages/chara (tests) | XIVAPI budgets, cache admission and resolver scope (SEC-05) | 0 / 3 / 11 | ✅ done (96ce158 to f356f5e, 3b67d55, add1f8b, 3ade39c) |
| 10 | apps/demo (tests) | State-machine and UI behaviour tests | 0 / 2 / 6 | ✅ done (151b33d, 11ff323, 90d8b28, 355fb2c) |
| 11 | docs + fixtures manifest | Producer compatibility record and refresh method | 0 / 2 / 5 | ✅ done (a80c0c9, 2ddb227) |

Severities are the verifiers' consensus; "Tier" follows the remediation-planner scale (P1 high, P2 medium, P3 low). IDs are defined in [the audit report](audit-2026-10-23.md), which carries the problem, failure scenario, evidence and fix for each.

## Wave 0 — packages/chara (appearance): Done in this session ✅ COMPLETED 2026-10-23 (04fbeff)

Fixed test-first and committed in `04fbeff`. Appearance policy is now `1.1.0` (unreleased; not in the published beta.3).
- **F096:** bit `0x80` of `Mouth` now gates the lip (`lipDisabled`; unknown when `Mouth` is missing or invalid; Hrothgar ignores it; an unknown race is active only when the bit is set).
- **F090:** the eye-pair rule is unchanged and documented as covering current Brio output; a new `EYE_PAIRING_UNCONFIRMED` warning flags a one-sided crossed match. **Residual:** custom eye colors on Brio v0.7.2+ exports are still not swapped (see Open decisions).
- **F092:** corrections, per-eye swatches and lip state of the four real exports are pinned in tests.
- **N001 (not in the original catalog):** bit `0x80` of `FacePaint` is a mirror flag in Brio and Ktisis; `FacePaint` 128 (no paint) showed a face-paint swatch. Fixed the same way.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F096 | High · P1 | `packages/chara/src/appearance/resolve.ts:170` | Lip swatch is reported active even when the lip-colour flag (0x80) in the `Mouth` byte is clear | Fixed |
| F090 | High · P1 | `packages/chara/src/appearance/resolve.ts:38` | Brio v0.7.2+ stores each eye's extended colour crossed relative to `LEyeColor`/`REyeColor`; only the exact on-grid crossing is repaired | Partly fixed: warning only |
| F092 | Low · P3 | `packages/chara/test/producer-exports.test.ts:58` | No test pins the eye correction or per-eye output for the real Brio export | Fixed |
| N001 | Low · P3 | `packages/chara/src/appearance/resolve.ts` | `FacePaint` 128 (no paint, mirrored) is reported as paint present; bit `0x80` is a mirror flag in Brio and Ktisis | Fixed |

**Ends with:** Verified 2026-10-23 (independent Opus review: pass with notes, all applied): build, type-check, lint, `verify-fixtures`, `verify-palettes`, 55 tooling + 376 package + 24 demo tests, and `pnpm test:package` (with the Windows `tar`). Publishing is Wave 3.

## Wave 1 — docs only: Documents that misstate the current state ✅ COMPLETED 2026-10-23 (5a4a6e9, 614ac34, 8d0d0b2, 0cd9f7f)

Cheap, no release, no code. **Anchor F075:** `SECURITY.md` accepts reports only for beta.1 and `main`, while npm `next` resolves to beta.3.
Check every claim against the code before editing (each finding names both locations); do not describe behaviour that Waves 2-3 are about to change.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F075 | Medium · P2 | `SECURITY.md:15` | Supported-version policy still names only beta.1 | Fixed |
| F083 | Low · P3 | `docs/security/THREAT_MODEL.md:9` | Completed gates are still listed as open; `xivapi-validation.md` contradicts itself | Fixed |
| F082 | Low · P3 | `docs/data-provenance.md:3` | Stale version numbers; also says the package contains synthetic examples | Fixed |
| F084 | Low · P3 | `README.md:59` | README says an appearance slot exposes `issues` | Fixed |
| F053 | Low · P3 | `docs/xivapi.md:3` | The export list omits `XivapiInputError` | Fixed |
| F085 | Low · P3 | `CONTRIBUTING.md:22` | Says tests and CI use only synthetic inputs, but real producer exports are read | Fixed |
| F087 | Low · P3 | `docs/cloudflare-hosting.md:68` | The deployed-origin check silently needs a matching local build | Fixed |
| F089 | Low · P3 | `README.md:13` | README calls the synthetic demo examples "anonymized" | Fixed |

**Ends with:** Done. Every changed claim was checked against the npm registry, the publish run, the code and the cited documents; a link and anchor check over the edited files found 0 broken (96 links); `pnpm test:tooling` passes (55 tests). An independent Opus review (pass with notes) found the same staleness in nearby documents (changelog, CONTRIBUTING, migration, compatibility, runbook, hosting record); those were fixed in the same wave (`0cd9f7f`). No release.

## Wave 2 — packages/chara (xivapi): The client was written against doubles that are not the real API ✅ COMPLETED 2026-10-23 (8959fc1, b20624f, e8cf5f9, ed0589a, ab358b0, b83c9de, dbf5b62, bdd1cbc, 298bd32)

**Anchor F051:** the live XIVAPI answers HTTP 404 for a whole `rows=` batch when any row is missing, so one unknown Stain or Glasses ID makes the whole lookup `unavailable`; the documented `notFound` and missing-row states cannot occur, and the test doubles return a 200 the real API never does.
- **Done (8959fc1):** the whole-sheet read does not work for Glasses (over 500 rows, no `next`), so the client recognises the live API's exact missing-row 404 for the requested sheet, drops that row and retries the rest, at most one extra request per missing row; the doubles now return the real 404. Verified against the live API.
- **G008 (b83c9de), docs only:** reproduced under local workerd on 2026-10-23, worse than inferred: with a module-scope client a queued lookup hung for 30 s and a later request on the isolate failed with `DEADLINE`. A client created per request completed every scenario, so the guides now say to create it per request and share only the cache. Module-scope reuse on Workers is still unsafe; fixing that in code would mean redesigning the scheduler.
- **G011, F052, F040, F050, F039:** all fixed test-first: option handling in `createDyeNameResolver`, the all-zero off-hand pairing, host cache calls capped at the request timeout (a hung write can no longer lower a complete result, and after one timeout the rest of the operation skips the cache), cache-hit ordering, and the browser opaque-redirect code. F052 and F040 were ruled low findings.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F051 | Medium · P2 | `packages/chara/src/xivapi/client.ts:272` | One nonexistent Stain/Glasses row makes the whole batch `unavailable` (the real API answers 404) | Fixed |
| G008 | Medium · P2 | `packages/chara/src/xivapi/client.ts:576` | The documented resolver reuse coalesces lookups across Cloudflare Worker requests (error 1101 / stranded jobs) | Fixed (docs; reproduced under workerd) |
| G011 | Medium · P2 | `packages/chara/src/dyes/index.ts:26` | `createDyeNameResolver` drops inherited and non-enumerable options and silently falls back to defaults | Fixed |
| F052 | Low · P3 | `packages/chara/src/xivapi/resolve.ts:95` | An all-zero off-hand pairs with any main-hand weapon whose ModelSub is 0 | Fixed |
| F040 | Low · P3 | `packages/chara/src/xivapi/client.ts:364` | A hung host-cache `set()` downgrades a fully fetched lookup to `partial`/`DEADLINE` | Fixed |
| F050 | Low · P3 | `packages/chara/src/xivapi/client.ts:385` | A cache hit returns rows in stored order, and unsorted entries are accepted | Fixed |
| F039 | Low · P3 | `packages/chara/src/xivapi/client.ts:236` | In browsers an opaque redirect is reported as `BODY_UNAVAILABLE`, not `REDIRECT_REFUSED` | Fixed |

**Ends with:** Done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`, then `pnpm test:package` (Windows `tar`): 55 tooling, 413 package and 24 demo tests pass. Two independent Opus reviews found a version-alias race, a hung cache spending a whole resolution's deadline, and several tests that could be weakened unnoticed; all were fixed (bdd1cbc, 298bd32), with mutation checks showing the new tests fail when the guards are removed. Not released: this publish is Wave 3.

## Wave 3 — packages/chara (reader, inspect, xivapi): Cross-realm input, re-read values, label accuracy; then publish ✅ COMPLETED 2026-10-23 (e965238, 60717a5, 7c49ade, d217c44)

Fixed test-first. **F001, G009, G010** were the same cross-realm `instanceof` pattern (`Uint8Array`, `AbortSignal`, body chunks); a new internal `realm.ts` reads the `%TypedArray%` brand through internal-slot getters and checks a signal by its members. F086 is now one shared signal check that runs before any request.
- **F054:** `resolve()` now reads `glassesId` once (F011, the same pattern in `modelKey`, was ruled info).
- **F086:** an invalid `signal` (including `null`) now throws `INVALID_LOOKUP`; a signal that cannot register its listener releases its subscriber. A `null` signal that the low-level client used to ignore is now rejected.
- **F010, F012:** integers above 255 in `Race`, `Tribe`, `Gender`, `Age` and `FacialFeatures` are now `invalid`; the reader's `ISSUES_TRUNCATED` marker is the single final entry of `inspection.issues`.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F001 | Low · P3 | `packages/chara/src/read.ts:53` | A `Uint8Array` from another realm is rejected as `INVALID_INPUT` | Fixed |
| G009 | Low · P3 | `packages/chara/src/xivapi/resolve.ts:141` | Only the resolver rejects an `AbortSignal` from another realm | Fixed |
| G010 | Low · P3 | `packages/chara/src/xivapi/client.ts:247` | Body chunks from another realm make every lookup `BODY_UNAVAILABLE` | Fixed |
| F086 | Low · P3 | `packages/chara/src/xivapi/client.ts:635` | An invalid `signal` throws `TypeError` after the request has started, leaving an orphaned subscriber | Fixed |
| F054 | Low · P3 | `packages/chara/src/xivapi/resolve.ts:47` | `resolve()` reads `glassesId` again after validating it | Fixed |
| F010 | Low · P3 | `packages/chara/src/inspect.ts:112` | Integers too wide for fields that can be `unsupported` are labelled `unsupported`, not `invalid` | Fixed |
| F012 | Low · P3 | `packages/chara/src/inspect.ts:216` | The reader's `ISSUES_TRUNCATED` can land mid-list in `inspection.issues` | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`, then `pnpm test:package` (Windows `tar`): 55 tooling, 463 package and 24 demo tests pass, and the tarball is now 43 files (a new shared chunk). A workflow review (two Opus reviewers, two verifiers per finding) confirmed seven gaps in the new code, none rejected; all were fixed (d217c44) and nine mutants of the new code are now killed. **Not done: the publish.** `package.json` is `0.1.0-beta.3`, which npm already lists, so a release needs a version bump (the maintainer chooses it) in `packages/chara/package.json` and the `expected_version` default in `.github/workflows/publish.yml`, a `CHANGELOG.md` release heading, then **Publish to npm** as a dry run first. The publish would carry Waves 0, 2 and 3.

## Wave 4 — repo tooling (scripts, test/, CI): Release and verification tooling that can pass vacuously ✅ COMPLETED 2026-10-24 (27d3c5e to 3fbe8a7)

Fixed test-first. Each tightened gate was shown failing against a deliberately broken input, and the new tests were mutation-checked (changes to the scripts that remove a guard are caught).
- **F029, F030, F028:** `build-palettes --check` now exits 1 when the file would change the committed palettes and writes nothing; write mode empties `source`/`sources` unless `--keep-sources` is passed; `verify-palettes` requires exactly the four artifacts and prints a total computed from them. Both scripts are tested from a replica of the repository layout, so a regression cannot touch the real palettes.
- **F081:** `verify-fixtures` fails on an empty manifest, on any `.chara` file that is not listed (found in any letter case, and never through a link) and on a changed `fixtures/expected/appearance.json`, which the manifest now pins.
- **F076, F077:** tool errors carry the exit status and both output streams (`tsc` writes its diagnostics to stdout), and the esbuild paths are anchored to the package root.
- **F078, F080:** the release script starts through a symlink or junction. Its logic is `runRelease`, and the preflight, prepare and verify modes are tested with injected inputs; the registry request's redirect option and 15 s timeout are pinned.
- **F079, F088:** every branch of the public-artifact policy is pinned (including `CharaSamples`), and the committed absolute paths are gone.
Nothing here ships in the package tarball; all of it is a gate that must still fail when it should.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F029 | Medium · P2 | `scripts/build-palettes.ts:77` | Write mode keeps the previous upstream `source`/`sources` provenance | Fixed |
| F028 | Low · P3 | `scripts/verify-palettes.ts:17` | `verify-palettes` does not require all four artifacts and prints a hard-coded total | Fixed |
| F030 | Low · P3 | `scripts/build-palettes.ts:72` | `--check` never compares anything; it exits 0 for any file of valid size | Fixed |
| F081 | Low · P3 | `scripts/verify-fixtures.ts:16` | `verify-fixtures` can pass vacuously; unlisted fixtures and `appearance.json` are not hashed | Fixed |
| F076 | Low · P3 | `scripts/test-package.ts:161` | `tsc` diagnostics from the installed-consumer check are lost | Fixed |
| F077 | Low · P3 | `packages/chara/scripts/build.ts:12` | esbuild paths are relative to the working directory, but `dist` deletion is relative to the script | Fixed |
| F078 | Low · P3 | `scripts/release.ts:238` | The CLI entry guard does nothing when the script is run through a symlink; `main()` wiring is untested | Fixed |
| F079 | Low · P3 | `scripts/package-policy.ts:13` | Several artifact-policy branches are unpinned; the `CharaSamples` case is masked by another match | Fixed |
| F080 | Low · P3 | `scripts/release.ts:162` | The registry preflight's `redirect` and timeout options are not asserted | Fixed |
| F088 | Low · P3 | `test/package-policy.test.ts:30` | Committed absolute paths reveal the maintainer's directory layout | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`, then `pnpm test:package` (Windows `tar`): 123 tooling, 463 package and 24 demo tests pass, and the installed tarball is still 43 files. A workflow review found gaps in the first fixes (release wiring that no test ran, an unpinned timeout, fixture discovery that missed upper-case extensions and followed links, a tool error that lost its exit status); all were fixed (2e3887a, 6e18e8e, 3fbe8a7).

## Wave 5 — apps/demo: State, focus and live-region fragility across re-renders ✅ COMPLETED 2026-10-24 (e8be1fd to e4bc6e7)

Fixed test-first with Playwright tests that were red before each fix; every group of new code was mutation-checked.
- **F060, G012:** a rejected replacement no longer leaves the retained file's swatches on "Loading…": the colors of the retained inspection are resumed in a new worker, and report Unavailable (keeping the rejection visible) if that fails too. The appearance message is a projection without the stored subtrees the inspection already carries.
- **G013:** the status line, the alert and a lookup announcer are written in place instead of being rebuilt on every render, and only when their text changes; a repeated identical error is announced again. The stored-values pager keeps its status element between pages.
- **F072, F074:** a control that a render disables or removes hands keyboard focus to the one that takes over (Resolve to Cancel and back, Clear to Choose); the example buttons and both pagers keep focus.
- **F069:** the stored-values panel is built once per inspection and moved into each render, so nested disclosures and the page being read survive Resolve, Cancel, a rejected replacement and example clicks.
- **F073, G014:** the Race row shows a stored Race that an unusable Tribe cannot confirm, labelled "declared"; `--muted` is `#5a6873` (5.15:1 on the rail), checked on every element that uses it.
Nothing here ships in the package tarball. No screen reader was run; the live-region behaviour follows the ARIA guidance cited in the audit.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F060 | Medium · P2 | `apps/demo/src/state.ts:134` | If a replacement file is rejected while appearance is still resolving, the retained file's swatches stay on "Loading…" | Fixed |
| G013 | Medium · P2 | `apps/demo/src/render.ts:383` | Live regions and alerts are recreated on every render | Fixed |
| F072 | Low · P3 | `apps/demo/src/render.ts:768` | Keyboard focus is lost when Resolve or Cancel is activated | Fixed |
| F074 | Low · P3 | `apps/demo/src/render.ts:270` | Pager buttons are destroyed when activated, which drops focus | Fixed |
| F069 | Low · P3 | `apps/demo/src/render.ts:764` | On re-render, nested stored-value disclosures collapse and paging resets | Fixed |
| F073 | Low · P3 | `apps/demo/src/render.ts:419` | The Race row says "Not stored" when Race is stored but Tribe is unusable | Fixed |
| G014 | Low · P3 | `apps/demo/src/styles.css:10` | `--muted` text fails WCAG AA contrast on tinted panels | Fixed |
| G012 | Low · P3 | `apps/demo/src/worker.ts:23` | The appearance message serialises the raw stored subtrees a second time | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`, then `pnpm test:package` (Windows `tar`) and `pnpm test:demo:cloudflare`: 123 tooling, 463 package and 47 demo tests pass (49 with the hosting checks, 1 live smoke skipped), and the tarball is still 43 files. A workflow review (three lenses, two verifiers per finding) confirmed ten findings, none disputed: a stale re-announce timer, focus lost from disclosure summaries, a resume-failure message that named the wrong file, and three timing races in the new tests; all were fixed (e4bc6e7) with six more mutants killed. **Not deployed:** `pnpm deploy:demo` is a manual action that needs the maintainer's yes.

## Wave 6 — apps/demo (tests): Evidence for the privacy and CSP gates (THREAT_MODEL SEC-03) ✅ COMPLETED 2026-10-24 (5d5574e to ba6353d)

No application code changed. Each new assertion was shown to fail against the weakened control it names: 16 weakened policies, 36 weakened versions of the icon loader, 28 leaks added to the app, 10 changed lookup requests, 4 HTML-injecting renders, and the recorder's own capabilities.
- **F064:** the served Content-Security-Policy is parsed into directives and compared for equality with a hard-coded, reviewed copy; a repeated directive fails.
- **G002, G004, G005, G006, G001:** `e2e/fixtures.ts` records requests (headers and bodies), console output with its serialised arguments, page errors, dialogs, navigations, popups, downloads and WebSockets from before the page loads, and fails every test on a private-data marker, a CSP violation, a request that is not a GET, a request to another origin, a WebSocket, SharedWorker or EventSource, or an uncaught error. `e2e/privacy.spec.ts` loads a file with markers in values, keys and the file name and checks the allowlists, including the exact shape of every lookup route and the state of storage, history and the file system afterwards; `e2e/recorder.spec.ts` shows the recorder detects each channel it claims to cover.
- **F061:** the icon loader's bounds are pinned by 18 Vitest unit tests (the demo gains a Vitest setup) and by browser tests with mocked icons, revocation and hostile responses.
- **G003:** `docs/demo.md` records the mechanism and its limits (a CSP violation raised inside the module worker is not reported to the page).

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F064 | Medium · P2 | `apps/demo/hosting/hosting.spec.ts:25` | CSP test uses substring checks; a widened policy or missing `base-uri`/`form-action` still passes | Fixed |
| G004 | Medium · P2 | `apps/demo/e2e/inspection.spec.ts:43` | SEC-03 request evidence ignores page-load and same-origin traffic | Fixed |
| G005 | Medium · P2 | `apps/demo/e2e/resolution.spec.ts:193` | No log/console canary; storage is checked only before lookup | Fixed |
| F061 | Medium · P2 | `apps/demo/src/icons.ts:4` | Icon loader security bounds have no automated coverage | Fixed |
| G001 | Low · P3 | `apps/demo/e2e/inspection.spec.ts:140` | The hostile-render test does not watch for requests, dialogs or navigation | Fixed |
| G002 | Low · P3 | `apps/demo/e2e/inspection.spec.ts:31` | No CI test watches requests from the start of page load | Fixed |
| G003 | Low · P3 | `docs/security/THREAT_MODEL.md:117` | SEC-03 log-canary evidence is missing and not recorded as an open item | Fixed |
| G006 | Low · P3 | `apps/demo/e2e/resolution.spec.ts:133` | In CI, lookup request minimisation is checked by a deny-list; allowlists exist only in the skipped live test | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`, then `pnpm test:demo:cloudflare`: 123 tooling, 463 package, 18 demo unit and 72 demo browser tests pass (74 with the hosting checks; 1 live smoke skipped). A workflow review (two lenses, two verifiers per finding) confirmed thirteen findings, none disputed: the default XIVAPI block had broken the opt-in live check, and the recorder missed Blob bodies, WebSockets, SharedWorker, page-exit sends, structured console arguments, history state and the file system, and pinned only some lookup values; all were fixed (ba6353d). Not deployed.

## Wave 7 — packages/chara (tests): Reader and inspection guards that can be deleted unnoticed ✅ COMPLETED 2026-10-24 (8a1b3fd to 726a01b)

No library code changed. Each new assertion was shown to fail against the weakened source it names: 122 weakened versions of the reader, issue and inspector code (117 caught at once; the five survivors were fixed with four more tests and the existing read test, and two mutants are equivalent), then 24 more after an independent review, all caught.
- **F002, F003, F004, F005, F007 (reader):** `test/read-guards.test.ts` pins the hand-written syntax checks on the discarded image string, the node, key-length and depth budgets inside the omitted subtree, a hard-coded table of the six ceilings and the defaults (each ceiling accepted, ceiling + 1 refused), the number grammar, and the path and issue-cap bounds.
- **F013-F017 (inspection):** `test/inspect-guards.test.ts` pins the weapon worn/empty rule and INCOMPLETE_MODEL, RACE_TRIBE_MISMATCH and UNSUPPORTED_VALUE with their paths, the numeric and alias forms of Race, Tribe, Gender and Age, vector and FacialFeatures parsing, metadata typing and the combined 64-issue cap.
- **F006:** `test/property.test.ts` now requires that malformed mutants are refused with the reader's own error and an allowed code, and that text native JSON accepts is read to the same value.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F002 | Medium · P2 | `packages/chara/src/read.ts:137` | No test covers the hand-written syntax checks on discarded image strings | Fixed |
| F003 | Medium · P2 | `packages/chara/test/read.test.ts:191` | Node and key-length budgets inside the omitted image subtree are untested | Fixed |
| F004 | Medium · P2 | `packages/chara/src/read.ts:20` | `READ_MAXIMUMS` values and acceptance at the ceiling are not pinned by tests | Fixed |
| F013 | Medium · P2 | `packages/chara/src/inspect.ts:207` | Weapon worn/empty rule and weapon `INCOMPLETE_MODEL` have no test | Fixed |
| F005 | Low · P3 | `packages/chara/src/read.ts:233` | Untested: a key exactly at `maxKeyLength`, valid exponents, `MAX_SAFE_INTEGER` | Fixed |
| F006 | Low · P3 | `packages/chara/test/property.test.ts:45` | Property mutation test accepts any thrown error and never checks that valid input is accepted | Fixed |
| F007 | Low · P3 | `packages/chara/src/issues.ts:11` | Multi-segment path budget and behaviour at exactly the issue cap are unpinned | Fixed |
| F014 | Low · P3 | `packages/chara/src/inspect.ts:248` | The `RACE_TRIBE_MISMATCH` and `UNSUPPORTED_VALUE` codes are never asserted | Fixed |
| F015 | Low · P3 | `packages/chara/src/inspect.ts:225` | Numeric Age/Race decoding and the `Miqote`/`AuRa` aliases are untested | Fixed |
| F016 | Low · P3 | `packages/chara/src/inspect.ts:79` | `vector()` count/length guards and FacialFeatures bounds are unpinned | Fixed |
| F017 | Low · P3 | `packages/chara/src/inspect.ts:262` | The numeric-typing rule for metadata fields and the combined 64-issue cap are untested | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test` passed when the wave was committed. A workflow review (two lenses, two verifiers per finding) confirmed sixteen findings, none disputed: all were gaps in what the new tests pin, none a library defect (726a01b). Test-only: no release of its own.

## Wave 8 — packages/chara (tests): Appearance maths and palette provider assertions ✅ COMPLETED 2026-10-24 (d5d064e to 0defad7)

Two small changes to shipped code: `colors()` in the default palette provider read a list with `some` and `every`, which skip the holes of a sparse array (F033), and the pre-read size gate of `scripts/build-palettes.ts` now has a message of its own (F038). Everything else is tests. Each new assertion was shown to fail against the weakened source it names: 273 weakened versions in all (color maths 91, appearance 91, palette provider 44, palette generator 22, build-palettes 25); the 11 that survive are equivalent and are listed in the commit messages.
- **F019, F020, F026 (`color-math-reference.test.ts`):** all 34 published CIEDE2000 pairs, pairs on both sides of the 180 degree hue wrap with values from a separate implementation, hex to Lab for every pair of 17 reference colors and for greys on both sides of the Lab knee, and compositing on the linear part of the encoder.
- **F021-F025, F027 (`appearance-policy.test.ts`, `appearance-guards.test.ts`):** policy validation and exact thresholds, a provider that gives every entry its own color (so a crossed palette shows), answers that do not belong to the request for both the hair and the skin slot, the all-zero block, index ranges and the lip composite guards.
- **F033, F035, F036, F037 (`palette-values.test.ts`):** the bundled JSON read directly, a synthetic dataset with a color per coordinate, dataset validation (including inherited names and sparse lists), requests that must load nothing, retry after a failed validation, and the frozen provenance record.
- **F034 (`palette-layout.test.ts`):** the generator is run over a buffer in which every entry holds its own position, so every palette offset, block size and order is read back.
- **F038 (`test/build-palettes-cli.test.ts`):** the arguments, the version patterns and the pre-read size gate, including a preload that shows no byte is read before a refusal.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F019 | Medium · P2 | `packages/chara/src/appearance/color-math.ts:65` | CIEDE2000 hue-wraparound branches are never asserted | Fixed |
| F020 | Medium · P2 | `packages/chara/src/appearance/color-math.ts:35` | hex→Lab conversion is asserted only for neutral (grey) colours | Fixed |
| F022 | Medium · P2 | `packages/chara/src/appearance/policy.ts:48` | Most policy validation untested; the "before provider work" ordering is never asserted | Fixed |
| F034 | Medium · P2 | `scripts/palette-generation.ts:19` | Generator test pins only some offsets and tribes, but the docs claim it proves them all | Fixed |
| F035 | Medium · P2 | `packages/chara/src/palettes/default-provider.ts:141` | No test checks the actual colour values returned for each gender | Fixed |
| F036 | Medium · P2 | `packages/chara/src/palettes/index.ts:25` | `shader-shared` loader wiring unpinned (only `eyes[0]` is sampled, and it is identical in both tables) | Fixed |
| F021 | Low · P3 | `packages/chara/src/appearance/resolve.ts:68` | Provider association and canonical-hex checks are mostly untested; the test title claims more than it checks | Fixed |
| F023 | Low · P3 | `packages/chara/src/appearance/resolve.ts:365` | Custom thresholds and the exact-equality boundaries are unpinned | Fixed |
| F024 | Low · P3 | `packages/chara/src/appearance/resolve.ts:141` | Unpinned: `ZERO_KEYS` completeness, and that ambiguity is independent of the flag | Fixed |
| F025 | Low · P3 | `packages/chara/src/appearance/resolve.ts:261` | Index 192 boundary, limbal kind, gridAddress, eyesShareIndex, metadata and composite clamp are never asserted | Fixed |
| F026 | Low · P3 | `packages/chara/src/appearance/color-math.ts:104` | `compositeHex` is tested only for white over black | Fixed |
| F027 | Low · P3 | `packages/chara/test/appearance.test.ts:14` | The mock provider hides errors in highlights/features palette routing | Fixed |
| F033 | Low · P3 | `packages/chara/src/palettes/default-provider.ts:39` | Validation rejection paths and `PALETTE_LOAD_FAILED` are untested; sparse arrays are accepted | Fixed |
| F037 | Low · P3 | `packages/chara/test/palettes.test.ts:86` | The deep-freeze guarantee is tested only at the top level | Fixed |
| F038 | Low · P3 | `scripts/build-palettes.ts:33` | The CLI's pre-read size gate and argument validation are untested | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`: 174 tooling, 1079 package, 18 demo unit and 72 demo browser tests pass. A workflow review (three lenses, two verifiers per finding) confirmed twenty findings, none disputed: seventeen were gaps in what the tests pin (the Lab and encoder knees, the hue wrap thresholds, the skin slot, the lip composite guard, the race index limit and tribe check before loading, the integer check on the index, retry after a failed validation, and whether the size gate runs before the read) and three were errors in the commit messages (an index limit called equivalent, F033 labelled F037, and a description of an old gate message that never existed); all were fixed (d5d064e to 0defad7). Test-only apart from the two changes above.

## Wave 9 — packages/chara (tests): XIVAPI budgets, cache admission and resolver scope (SEC-05) ✅ COMPLETED 2026-10-24 (96ce158 to f356f5e, 3b67d55, add1f8b, 3ade39c)

Two changes to shipped code, both found by reviews of the new tests. A `Retry-After` is waited for only when it is delay-seconds or an HTTP date in the IMF-fixdate form: before, `Date.parse` decided, and V8 reads `-1`, `+1` and `1.` as 1 January 2001, so the same response was retried at once in one browser and refused in another. And `createXivapiClient` and `createXivapiResolver` read each option once and answer `INVALID_OPTIONS` for an option whose getter throws, a `languages` list with a hole (beta.3 accepted it as a language `undefined`) or an element or length that throws, and read the cache's `get` and `set` once when the client is created (before, the raw error escaped for a throwing getter or element). Everything else is tests.
- **F043, F044, F046, F056 (`xivapi-cache.test.ts`, `xivapi-cache-edges.test.ts`):** each cache-admission gate from both sides, the memory cache's capacity, recency and expiry rules (the key counts toward the 8 MiB), that a cache hit reproduces what a fresh response gives, and that cached rows count against the 5,000 rows of a resolution.
- **F042, F045, F047, F048, F049 (`xivapi-budgets.test.ts`, `xivapi-transport-edges.test.ts`):** the transport limits from both sides (nesting, string and key length, node count, 500 results, the 2 MiB page and 10 MiB resolution budgets, cursor and page limits, the version list), every redirect status, every `Retry-After` form, and the ten-minute lifetime of the learned schema and of a resolved alias.
- **F055, F057, F058, F059 (`xivapi-rows.test.ts`, `xivapi-rows-edges.test.ts`, `xivapi-limits.test.ts`, `xivapi-resolver-scope.test.ts`):** the row guards, the dye and model count limits, the option guards and the scope of the resolver's issues.
- **G007 (`test/runtime/smoke.ts`):** the default native-fetch transport now runs once in each runtime, against a closed loopback port, so an option a runtime refuses is seen (shown with `integrity`, which workerd refuses).

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F042 | Medium · P2 | `packages/chara/test/xivapi-client.test.ts:398` | Transport depth/node budgets unpinned; malformed-structure test asserts only the status | Fixed |
| F043 | Medium · P2 | `packages/chara/src/xivapi/cache.ts:28` | Most `admittedJson` cache-admission gates untested | Fixed |
| F056 | Medium · P2 | `packages/chara/src/xivapi/rows.ts:175` | The `sameData` rejection path in `cachedRow` is untested | Fixed |
| F044 | Low · P3 | `packages/chara/src/xivapi/cache.ts:105` | The memory cache's LRU touch is untested (a FIFO cache would pass) | Fixed |
| F045 | Low · P3 | `packages/chara/src/xivapi/client.ts:357` | Expiry, cap and isolation of the default-schema memo are untested | Fixed |
| F046 | Low · P3 | `packages/chara/src/xivapi/client.ts:387` | The duplicate-rowId check and row accounting on cache hits are untested | Fixed |
| F047 | Low · P3 | `packages/chara/test/xivapi-client.test.ts:325` | The redirect test does not pin `REDIRECT_REFUSED` | Fixed |
| F048 | Low · P3 | `packages/chara/src/xivapi/client.ts:269` | The Retry-After cap boundary and the retry-once rule are untested | Fixed |
| F049 | Low · P3 | `packages/chara/src/xivapi/client.ts:477` | Cursor, 2 MiB and version-list budgets are tested only above the limit, and the cursor test is masked | Fixed |
| F055 | Low · P3 | `packages/chara/src/xivapi/rows.ts:67` | The range and sheet guards on item rows are untested | Fixed |
| F057 | Low · P3 | `packages/chara/src/xivapi/query.ts:65` | The 64-ID / 24-model limits are tested only on the rejecting side; the dye error code is unpinned | Fixed |
| F058 | Low · P3 | `packages/chara/src/dyes/index.ts:23` | The options guard, which other code relies on, is untested | Fixed |
| F059 | Low · P3 | `packages/chara/src/xivapi/resolve.ts:158` | The `items`/`facewear` scope prefix on issues and the mixed off-hand case are unpinned | Fixed |
| G007 | Low · P3 | `test/runtime/smoke.ts:9` | The default native-fetch transport never runs in Node, Node Worker or workerd | Fixed |

**Ends with:** Code done. `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test` (174 tooling, 1458 package, 18 demo unit and 110 demo browser tests), `pnpm test:demo:cloudflare` (112 passed) and `pnpm test:package` pass. A workflow review (three lenses, two verifiers per finding) reported 34 confirmed findings and rejected one: gaps in what the tests pin (the Retry-After forms, cache-hit row accounting, the option snapshot), wrong "equivalent mutant" claims in the commit messages and the two code changes above; all were fixed (96ce158 to f356f5e, 3b67d55, add1f8b). The mutants that stay alive are equivalent and are listed in the commit messages.

## Wave 10 — apps/demo (tests): State-machine and UI behaviour tests ✅ COMPLETED 2026-10-24 (151b33d, 11ff323, 90d8b28, 355fb2c)

One change to shipped demo code: a file over the 8 MiB limit is refused with a note that says why (an Anamnesis file saved with a large embedded image can be bigger, and the library can read most such files when `maxBytes` is raised, up to 64 MiB), also when the previous file's colors are resumed afterwards (the demo part of F099). Everything else is tests, driven by a helper that holds the XIVAPI requests and records which ones the page gave up on, and by a paused clock that probes the five-second deadline to the millisecond.
- **F067, F062 (`lookup-lifecycle.spec.ts`):** Clear, a replacement file and Cancel abort the held request (seen on the network as failed), Resolve works again, nothing comes back from an abandoned request, and the result of a finished lookup is not shown for the next file.
- **F068, F063:** no alert at 4,999 ms and PROCESSING_TIMEOUT at 5,000, what the timed-out worker posts later is ignored, also when the previous file's colors were still loading and are resumed; no timeout is reported once the colors have arrived; APPEARANCE_TIMEOUT and PROCESSING_FAILED keep the inspection or the previous file.
- **F065, F066:** a file of exactly 8 MiB and the file-name patterns, the three ways an example fails or is abandoned, and the diagnostics list (64 entries in full, 65 list 64 and say that more were omitted: `diagnostics.spec.ts`).
- **F070, F071:** "Show previous" (a regex that had lost its backslash), and the Glasses id sent, or not sent, as a facewear lookup.

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F067 | Medium · P2 | `apps/demo/src/state.ts:46` | No test confirms that clear or replacement aborts a lookup and re-enables Resolve | Fixed |
| F068 | Medium · P2 | `apps/demo/e2e/inspection.spec.ts:4` | Timeout test cannot observe worker termination, and the deadline is pinned only from above | Fixed |
| F062 | Low · P3 | `apps/demo/src/state.ts:64` | No test exercises the "Cancel lookup" control | Fixed |
| F063 | Low · P3 | `apps/demo/src/state.ts:104` | The timeout path after inspection has committed, and the worker `onerror` handler, are untested | Fixed |
| F065 | Low · P3 | `apps/demo/src/state.ts:79` | The size/extension admission gate is tested only from above | Fixed |
| F066 | Low · P3 | `apps/demo/src/state.ts:154` | Failure and abort of the example fetch, and the diagnostics cap, are untested | Fixed |
| F070 | Low · P3 | `apps/demo/e2e/resolution.spec.ts:75` | The "Show previous" assertion is a substring tautology | Fixed |
| F071 | Low · P3 | `apps/demo/src/state.ts:198` | The facewear filter and rendering are covered only by the skipped live test | Fixed |

**Ends with:** Code done. `pnpm --filter @xivcharakit/demo test` (18 unit and 110 browser tests) and `pnpm test:demo:cloudflare` (112 passed) pass. The same workflow review as Wave 11 (below) confirmed nine findings in the demo tests, none disputed: the retained colors resumed after a timeout, the deadline after a success, `reading` after a refusal, a finished lookup carried into the next file, the diagnostics cap and the size note on the resumed path were unpinned; two assertions could not fail; one regex had lost its backslash; and the pause time of the clock left a second of margin. All were fixed (151b33d, 11ff323, 90d8b28). The worker's error handler without `preventDefault` was first left alive by every check; a test now reads `defaultPrevented` on the worker's error event and catches it.

## Wave 11 — docs + fixtures manifest: Producer compatibility record and refresh method ✅ COMPLETED 2026-10-24 (a80c0c9, 2ddb227)

Documentation, the fixture manifest and one regression test; no library code. The manifest pins 32 upstream files in all, each with the SHA-256 of the raw file at the pinned commit (all re-hashed), and the refresh method now compares meaning as well as bytes (`AGENTS.md`, `docs/compatibility.md`).
- **F091, F093, F095:** the files that give stored values their form and meaning are pinned (metadata and image fields, the color and vector formats, the enum names, the Ktisis writer, Brio's vector converters), and so are the three files that the stated limits rest on.
- **F097:** which producer writes extended colors and `IsExtendedAppearanceValid`. Anamnesis never writes the flag and Ktisis writes no extended colors, so an Anamnesis export's stored block is inactive evidence. For a race with a lip palette index the lip differs from a Brio-shaped file only when the lip-color bit of `Mouth` is set; a Hrothgar's lip is a fur pattern and a stored lip color shows only with the flag. Pinned by an Anamnesis-shaped test in `producer-exports.test.ts`.
- **F094, F098:** none of Anamnesis v7.57.0.3, Ktisis v0.4.1.2 and Brio v0.8.0.12 can export selectively, so the "Partial export" gates are recorded as unavailable in the current producers (legacy builds are not verified).
- **F099 (the record):** the Anamnesis embedded-image limit and the size at which it passes the 8 MiB budget; the demo message is in Wave 10. Raising the default budget stays open (D3).

| ID | Sev · Tier | Location | Item | Status |
|---|---|---|---|---|
| F091 | Medium · P2 | `docs/compatibility.md:15` | Compatibility review never pinned the eye-field semantics, and calls current Brio behaviour "historical" | Fixed |
| F094 | Low · P3 | `docs/producer-fixture-validation.md:12` | Ktisis partial export is listed "Pending", but current Ktisis cannot export selectively | Fixed |
| F093 | Low · P3 | `docs/compatibility.md:15` | The Ktisis sources for enums and the writer are not pinned | Fixed |
| F095 | Low · P3 | `docs/compatibility.md:15` | The Anamnesis files that define metadata and colour/vector formats are not pinned | Fixed |
| F097 | Medium · P2 | `packages/chara/src/appearance/resolve.ts:140` | Anamnesis exports never carry `IsExtendedAppearanceValid`, so their extended colours are never live; this is not disclosed | Fixed |
| F098 | Low · P3 | `docs/producer-fixture-validation.md:11` | The Anamnesis "Partial export: Pending" gate cannot be met | Fixed |
| F099 | Low · P3 | `packages/chara/src/read.ts:13` | The default 8 MiB budget rejects Anamnesis exports with images Anamnesis itself accepts; not documented | Fixed |

**Ends with:** `pnpm verify-fixtures` passes. A workflow review of Waves 9 to 11 confirmed 36 findings, none disputed. In the record they were claims wider than the evidence (a reader that "does not depend on any one separator" splits on a comma only, the lip consequence, a Brio partial export that was not available, limits resting on unpinned files, a broken anchor, "historical" prose, the clipboard-image size) and the Brio `SkinGloss: null` shape that F091 asked to record; in the tests, the live gate of the extended-only paths, the own-shader guard of the eye-pair rule, all six slots of the Anamnesis export and a color value that tells the decodings apart. All were fixed (a80c0c9, 2ddb227).

## Open decisions

| # | Decision | Why it is open | Default if nobody decides |
|---|---|---|---|
| D1 | F090 residual: swap eye colors heuristically when only one crossed match is visible? | A one-sided match next to a custom color is evidence, not proof; a false swap mirrors correct colors, and the library has no producer routing by design. | Keep the warning only. |
| D2 | Clear the three `undici` advisories (1 high, 2 moderate, development dependency only) reached through `wrangler` and `miniflare` | `pnpm audit` newly fails and CI and the publish workflow run it; not an audit finding, found while verifying. Even wrangler 4.152.0 ships `undici` 7.29.1, so bumping wrangler does not help. | Decided 2026-10-24: an exact override `miniflare>undici: 7.30.1` in `pnpm-workspace.yaml`; `pnpm audit` reports nothing. Drop it when wrangler ships a patched miniflare. |
| D3 | Whether to raise the 8 MiB default read budget (F099) | Anamnesis can write files above it; the budget is a documented trade-off. | Keep; document the limit. |
| D4 | Version for the next publish | `0.1.0-beta.3` is already on npm, and Wave 0 changes the appearance policy and the `AppearanceReason` union. | Decided 2026-10-24: the version is bumped to `0.1.0-beta.4` (tag `next`) in the pull request. Publishing it stays a separate step: dry run, then protected approval. |

## Not scheduled

### Register: ruled info or no defect

| ID | Item | Reason | Revisit trigger |
|---|---|---|---|
| F009 | `ModelBase 0` with a non-zero variant is classified `empty` | Matches game semantics and the literal sentences of `docs/compatibility.md`; only the docs are silent. | Add one sentence and a test when Wave 1 or 11 touches that table. |
| F011 | `modelKey` re-reads properties after validating them | Accessor-backed models are outside the contract in `implementation-progress.md`. F054 (same pattern) is scheduled in Wave 3, which is inconsistent. | Revisit if Wave 3 reads once in `modelKey` too. |
| F031 | Four creator palettes are byte-identical | Faithful copy of the 7.57 game file (they differ only in alpha). Do not "correct the offsets". | Optional provenance note with F034. |
| F032 | Shipped `dist` palette chunks are not hash-verified | `build.ts` has no palette transform step; hardening only. | If the build ever transforms palette data. |
| F041 | A cold process never reads the cache with the default schema | Documented 10-minute memo; mechanism is accurate. | Document it and recommend a pinned `rev:` schema for persistent caches. |

### Register: refuted candidates

F008 (`hasEmbeddedImage` for a null or empty image field is intended and tested) and F018 (explicit `undefined` policy options throw by the library's documented convention). See §8 of the report.

### Register: unverified observations

The 22 info-level observations in §9 of the report were never verified. Promote one to a finding only after reading the code it names.

## Standing guidance

- Verify each finding's evidence against the code before fixing: findings are leads, and the first-pass reviewers were wrong about line numbers and mechanisms often enough that the verifiers corrected several anchors (report §9).
- Test first, and watch the new test fail for the stated reason; for any gate-pinning test, break the guarded code on a scratch copy and confirm the test fails.
- Run the standing gate at every wave boundary: `pnpm build && pnpm type-check && pnpm lint && pnpm verify-fixtures && pnpm verify-palettes && pnpm test`, then `pnpm test:package` for any wave that touches the library. On Windows, put `C:\Windows\System32` first on `PATH` for `test:package`: GNU `tar` from Git Bash fails on `C:` paths.
- Producer-format claims need the producer's source at a pinned commit: record the date, release and commit, and say what was source-reviewed versus tested against a real export (`AGENTS.md`).
- Publishing is Actions-only (trusted publishing); deploying the demo (`pnpm deploy:demo`) and any push are the maintainer's call.
- Annotate executed waves in the heading: **✅ COMPLETED <date> <commits>**. This document doubles as the tracker.
- Do not put exploit detail for unpatched findings anywhere but the audit report.
