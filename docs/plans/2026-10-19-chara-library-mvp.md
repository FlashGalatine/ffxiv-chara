# ffxiv-chara MVP Implementation Plan

Current identity: **XIVCharaKit**, npm package `xivcharakit`, repository `FlashGalatine/XIVCharaKit`. The original plan title, filename and earlier repository references below are historical; see the [rename record](../rename-preparation.md) for the completed GitHub operation and current local changes.

**Status:** implementation reopened by the maintainer on 2026-10-19. Tasks 1–7, local dye names and Task 8 distribution/runtime tooling and CI configuration are implemented, with initial Task 0 evidence. See [implementation progress](../implementation-progress.md) for local/hosted verification and unresolved release/compatibility gates. Original planning-only language below describes the earlier baseline and is superseded by this authorization.

> **For agentic workers:** Execute the selected milestone inline using superpowers:executing-plans and test-driven development, with a final independent review. Checkboxes track implementation where complete; pending tasks do not authorize publication, deployment, or consumer migration.

**Goal:** Build an open source, reusable `.chara` inspection library for Anamnesis, Ktisis, and Brio, with appearance swatches, optional XIVAPI equipment resolution, and a small website demonstrating the public API.

**Architecture:** One independently maintained TypeScript package exposes a parser/inspection entry point and optional `/appearance`, `/palettes`, and `/xivapi` entry points. A private demo application lives alongside the package and consumes those exports. Parsing and appearance interpretation run locally; the optional equipment resolver sends only equipment identifiers to XIVAPI.

**Tech Stack:** Proposed: strict TypeScript, ES2022 ESM and declarations; pnpm workspace; esbuild for portable library bundles and JSON data chunks; Vite with ordinary DOM rendering for the demo; Vitest and Playwright; tsx for maintainer scripts. No UI framework or XIV Dye Tools package is a runtime dependency of the library. Resolve and lock compatible tool versions when implementation starts; no dependencies are installed by this planning task.

**Spec:** The agreed design is recorded in [Agreed MVP brief](#agreed-mvp-brief) below. The user requested an implementation plan only, so this document carries that brief instead of creating a separate spec.

## Agreed MVP brief

The project is a shareable open source library with a simple demonstration website, housed in a specialized repository. It reads and inspects the `.chara` format used by Anamnesis, Ktisis, and Brio. The MVP includes typed appearance/equipment inspection, appearance swatches, and XIVAPI equipment resolution. Editing and writing compatible `.chara` files are deferred to a future version.

The accepted module boundaries are the main parser/inspection API, appearance interpretation, versioned palette data, and an optional XIVAPI adapter. The demo provides local files and anonymized examples, character information and swatches, stored values, and equipment lookup results. It demonstrates the library rather than maintaining a second implementation.

Compatibility must include selectively saved files, producer differences, missing data, extended appearance colors, and equipment that matches multiple items. Preserve stored values and explain interpretation instead of presenting heuristics as facts.

## Global constraints

- **Implementation reopened.** Local code, development dependencies, tests, builds and review artifacts are authorized. Do not change existing applications, publish packages, or deploy the website as part of this initial milestone.
- **Reading and inspection only.** No editing controls, `.chara` serializer, file conversion, or write-back API in the MVP.
- **Independent package.** No dependency on `@xivdyetools/core`, application services, Cloudflare bindings, browser storage, or DOM APIs in library entry points. The demo is the browser-specific consumer.
- **Optional work stays optional.** Importing the main entry point must not load palettes, perform network requests, or import the XIVAPI adapter. Appearance resolution must not require XIVAPI.
- **Preserve evidence.** Keep raw field values alongside normalized values and diagnostics. Distinguish absent, explicit null, zero, false, empty, invalid, and unsupported values. Never mutate the source document to repair it.
- **Partial documents are supported.** Recognized equipment-only or appearance-only exports must not be rejected for lacking color fields. A producer label alone is insufficient evidence that arbitrary JSON is a character file.
- **Image handling is separate.** Do not decode, display, return, or send embedded `Base64Image` payloads. Report their presence without retaining that payload in the inspection document. Apply input limits before parsing.
- **Privacy in the demo.** Hold user documents in memory; no telemetry or automatic persistence. Do not send file contents, file names, author/nickname fields, appearance values, or dyes to equipment resolution. Render imported strings as text.
- **Equipment identity is a candidate set.** Return matching rows, ambiguity, and resolution status. A model match does not establish the original inventory item. Preserve NPC/modded/unmatched model identifiers.
- **Data provenance is explicit.** Creator palettes and shader palettes are different datasets. Version the dataset format separately from the game/source revision; an unknown game version remains unknown. Do not vendor the raw `human.cmp` game file.
- **No automatic release actions.** A later implementation may prepare package/site artifacts; package publication and website deployment require their own authorized scope and resolved destinations.

### Proposed implementation defaults

These are draft engineering choices, not additional user decisions. Revisit them with the plan when implementation is reopened.

| Decision | Proposed default | Reason / boundary |
|---|---|---|
| Repository/package identity | Public GitHub repository `FlashGalatine/ffxiv-chara`; npm package identity unassigned | Repository setup is authorized; npm naming and publication remain separate decisions |
| Structure | `packages/chara` plus private `apps/demo` | One published package, one example consumer |
| JavaScript support | ES2022 ESM, TypeScript declarations, browser/Node/Worker-compatible APIs | Test installed-package imports in each target; avoid Node built-ins in library code |
| Input bounds | 8 MiB UTF-8 bytes, depth 32, 100,000 visited JSON nodes | Configurable; allows the previously observed image-bearing export while bounding work; these are proposed limits, not a universal format requirement |
| Existing host limit | Keep XIV Dye Tools' 8 KiB import policy in its host adapter | The public library's compatibility policy must not silently change the existing web/bot policy |
| Appearance policy | Extended values are active only when declared valid; preserve both palette and extended evidence | Port and document existing behavior before proposing policy changes |
| Appearance heuristics | Existing off-grid threshold 6 DeltaE2000; eye-pair correction (identifiers say "historical") requires both crossed matches within 1 DeltaE2000 and neither own match | Expose the policy and record applied corrections; parsing itself never swaps fields |
| XIVAPI operations | 10-second request timeout; one retry for 429/503 only when the delay is at most 2 seconds; otherwise report unavailable | Never retry caller cancellation; accept a bounded Retry-After or use a 250 ms delay |
| XIVAPI pages | Follow search cursors; default maximum 20 pages per operation | Reaching the bound yields an explicitly partial result, never a definitive missing-item answer |
| Cache defaults | Complete positive rows 7 days; complete empty rows 10 minutes; refresh a changing `latest` alias after 10 minutes | Namespace by resolved version and response shape; no failed/partial negative entries |
| Demo language | English UI; resolver supports XIVAPI's en/ja/de/fr names | Additional UI locales and regional item-name datasets are separate scope |
| Demo hosting | Static artifact first; transport and hosting verified before deployment | A backend/proxy is not silently added to this MVP |

## Review focus

1. **Equipment-only export or unfamiliar producer label:** inspection succeeds from supported fields, with missing appearance reported rather than a generic parse failure. Owned by Tasks 1–2.
2. **Malformed, large, deeply nested, or prototype-shaped input:** bounded work, fixed error categories, no unsafe object merge, and no payload echoed through diagnostics. Owned by Tasks 1–2.
3. **Creator/shader mismatch, inactive extended values, or missing tribe/gender:** preserve the raw values and both color sources; display only an interpretation supported by available data. Owned by Tasks 3–4.
4. **Truncated search, upstream outage, or a shared weapon/off-hand model:** distinguish incomplete/unavailable from not found; match off hands in the context of their main hand. Owned by Tasks 5–6.
5. **A second file replaces the first during an API request:** no stale results can attach to the new file; local parsing/swatches remain usable when lookup fails. Owned by Task 7.

## Existing source and extraction inventory

Planning baseline: the XIV Dye Tools source snapshot at `b98c8584a85f5dc50b4b4392c508cc627ef004d6`, inspected 2026-10-19. Source links below are pinned to that commit in `FlashGalatine/xivdyetools`. Refresh these references when execution starts. Paths describe source material, not permission to change those files during this planning task.

| Existing source | Reuse / adaptation |
|---|---|
| [Core parser](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/src/services/chara/chara-parser.ts), [model helpers](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/src/services/chara/chara-models.ts) | Decode fields and pack model keys; generalize beyond the current color-focused return type and remove the color-field-only recognition gate |
| [Appearance resolver](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/src/services/chara/chara-resolver.ts), [shader lookups](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/src/services/chara/chara-shader-colors.ts) | Preserve interpretation rules and source evidence; remove the `DyeService`/full core dependency |
| [Character colors](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/src/services/CharacterColorService.ts), [palette data](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/src/data/character_colors/index.json), [generator](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/packages/core/scripts/build-character-colors.ts) | Extract only palette access and required color math; carry creator and shader data plus regeneration provenance |
| [XIVAPI client](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/api-worker/src/chara/xivapi.ts), [equipment resolver](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/api-worker/src/chara/resolver.ts), [wire types](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/api-worker/src/chara/types.ts) | Extract request/response handling and pure matching; decouple generated acquisition/regional-name tables and worker infrastructure |
| [Cache adapter](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/api-worker/src/chara/cache.ts), [HTTP router](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/api-worker/src/chara/router.ts) | References for versioned caching and validation; do not copy Cloudflare/Hono infrastructure into the public library |
| [Web loader](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/web-app/src/services/chara-file-loader.ts), [session](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/web-app/src/services/chara-session-service.ts), [reader host](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/apps/web-app/src/components/glamour-tool.ts) | References for consumer integration, input policy, and stale-work handling; application services stay in the host |
| [Color corpus research](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/docs/research/2026-09-28-chara-corpus-profile/README.md), [equipment research](https://github.com/FlashGalatine/xivdyetools/blob/b98c8584a85f5dc50b4b4392c508cc627ef004d6/docs/research/chara-equipment-resolution/README.md) | Historical evidence and regression candidates; verify before making general compatibility claims |

Upstream references for the future compatibility inventory: [Anamnesis character-file implementation](https://github.com/imchillin/Anamnesis/blob/master/Anamnesis/Files/CharacterFile.cs), [Ktisis](https://github.com/ktisis-tools/Ktisis), [Brio](https://github.com/Etheirys/Brio), and [XIVAPI search documentation](https://v2.xivapi.com/docs/guides/search/). Record commit-pinned format sources during Task 0; moving branch links are not a permanent compatibility contract.

## Future file structure

This is the target implementation structure for `ffxiv-chara`. The repository currently contains only its README and this plan; no library, demo, fixture, or build files have been created.

In task file lists, `src/` and `test/` are relative to `packages/chara/`; adjacent abbreviated filenames share the preceding directory. `scripts/`, `docs/`, and `apps/` otherwise refer to the future repository root. The library build script is explicitly `packages/chara/scripts/build.ts`.

```text
packages/chara/
  package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts
  scripts/build.ts
  src/index.ts, types.ts, errors.ts, field-spec.ts, read.ts, inspect.ts, models.ts
  src/appearance/index.ts, types.ts, resolve.ts, color-math.ts, policy.ts
  src/palettes/index.ts, types.ts, default-provider.ts, metadata.json
  src/palettes/data/creator-shared.json, creator-race.json, shader-shared.json, shader-race.json
  src/xivapi/index.ts, types.ts, client.ts, query.ts, resolve.ts, cache.ts
  test/read.test.ts, inspect.test.ts, models.test.ts, palettes.test.ts, appearance.test.ts
  test/xivapi-client.test.ts, resolution.test.ts, package.test.ts
  test/runtime/node.ts, browser.ts, worker.ts, wrangler.toml
fixtures/
  manifest.json
  anamnesis/, ktisis/, brio/, partial/, invalid/
  expected/appearance.json, equipment-rows.json
apps/demo/
  package.json, index.html, vite.config.ts, playwright.config.ts
  src/main.ts, state.ts, render.ts, styles.css
  public/examples/manifest.json, anamnesis.chara, ktisis.chara, brio.chara
  e2e/inspection.spec.ts, resolution.spec.ts
scripts/build-palettes.ts, verify-palettes.ts, test-package.ts
docs/compatibility.md, data-provenance.md, api.md, migration.md
.github/workflows/ci.yml
package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json
README.md, LICENSE, NOTICE, CONTRIBUTING.md, .gitignore
```

## Shared API contracts proposed for the draft

Finalize these names when reopening the plan; subsequent tasks use them consistently. These are interface descriptions, not implemented APIs.

- `readChara(input: string | Uint8Array, options?: ReadOptions): CharaDocument` — bounded JSON decoding and character-field recognition; throws `CharaInputError` for fatal input errors. `CharaDocument` contains sanitized stored fields, unknown fields, declared producer information, and an embedded-image presence flag.
- `inspectChara(document: CharaDocument): CharaInspection` — returns normalized identity/customization, twelve equipment slots, facewear, and structured issues. Every inspected field carries its original value and presence/validation state.
- `modelKey(model: EquipmentModel): string` — decimal packed model key; weapon packing uses `bigint` internally and never leaks it into JSON results. `EquipmentModel` retains slot and individual lanes.
- `createDefaultPaletteProvider(): PaletteProvider` — supplies creator/shader entries and dataset metadata, loading the bundled tables lazily. `PaletteProvider.getColor(request: PaletteRequest): Promise<PaletteColor | null>` is the injectable lookup contract; `PaletteRequest` names table kind, palette, index, tribe, and gender where required.
- `resolveAppearance(inspection: CharaInspection, options: AppearanceOptions): Promise<AppearanceInspection>` — `AppearanceOptions` requires a `PaletteProvider` and optionally overrides the versioned policy. Each slot reports stored index/float, creator/shader/extended hexes, active state, interpretation, optional lip composite, diagnostics, and any applied eye-pair correction.
- `createXivapiResolver(options?: XivapiOptions): EquipmentResolver` — options accept `fetch`, base URL, version/schema, page limit, cache, and timeout. No import-time I/O. `EquipmentResolver.resolve(input: EquipmentResolveInput, options?: { signal?: AbortSignal }): Promise<EquipmentResolution>` accepts equipment models and an optional glasses ID only.
- `EquipmentResolution` contains per-slot candidates and status `matched | notFound | partial | unavailable`, a separate facewear result with the same status vocabulary, upstream version information, and issues. Candidate data includes item ID, localized names, icon reference, available rules, and `viaMainHand`. Missing rule fields remain unknown.
- `ResolutionCache.get(key: string): Promise<CachedRows | null>` and `set(key: string, value: CachedRows, ttlMs: number): Promise<void>` store normalized upstream row sets, not character-specific final selections. `CachedRows` records schema/version, completeness, and rows.
- All `Issue` values have `code`, `severity`, and a structured field path; descriptions are bounded and never stringify arbitrary supplied values. Public error codes are stable and independent of UI wording.
- Fatal reader codes are `INPUT_TOO_LARGE`, `INVALID_UTF8`, `INVALID_JSON`, `NOT_CHARACTER`, `MAX_DEPTH`, and `MAX_NODES`. Accept one leading UTF-8 BOM, count it toward the byte limit, and decode byte input with fatal UTF-8 validation.

## Task 0: Confirm destination and establish the compatibility evidence

**Future files:** `docs/compatibility.md`, `docs/data-provenance.md`, `fixtures/manifest.json`, producer/partial/invalid fixtures and reviewed expected results.

**Interfaces:** Produces the field/presence matrix, fixture manifest, and palette provenance that Tasks 1–6 consume.

- [ ] After explicit implementation authorization, confirm the existing `FlashGalatine/ffxiv-chara` checkout, then resolve npm identity, code license/notices, and the intended demo destination with the maintainer. Re-read repository/skill instructions and select an execution method. No publication or deployment is implied.
- [ ] Pin Anamnesis/Ktisis/Brio format implementations by commit; inventory metadata, save-section flags, identity/body/face/hair fields, extended appearance, gear, dual stains, facewear, and known spelling/shape differences. Document unsupported fields explicitly rather than claiming every historical/future export is supported.
- [ ] Collect sanitized, redistributable examples from all three producers, including full, equipment-only, appearance-only, and extended-color cases. Record producer/version when known, source permission/license, SHA-256, and expected semantics. Do not copy the user's private corpus wholesale or publish identifying metadata.
- [ ] Record creator/shader dataset source commit and hashes. Distinguish the existing data schema version from the actual game revision, which is not established by `index.json` alone. Record provenance/notices without declaring game-derived data to be covered automatically by the code license.
- [ ] Review the proposed input limits and swatch policy against those fixtures; resolve disagreements before implementing the contract. Commit the evidence and agreed contracts in the future repository.

**Exit:** A reviewer can identify the supported format snapshots, anonymized examples, and ground truth independently of the implementation.

## Task 1: Deliver the portable package and bounded document reader

**Future files:** Workspace/package/build configuration; `src/index.ts`, `types.ts`, `errors.ts`, `field-spec.ts`, `read.ts`; `test/read.test.ts`.

**Interfaces:** Consumes Task 0's field matrix. Produces `readChara`, `ReadOptions`, `CharaDocument`, `CharaInputError`, and the shared `Issue`/presence types.

- [x] Write failing cases: valid full/partial character objects; gear-only export; invalid JSON/top-level array; pose-only object; a spoofed `TypeName` with no character fields; UTF-8 multibyte input exactly at/over `maxBytes`; invalid UTF-8; a leading BOM; depth/node bounds; `__proto__`/`constructor` data keys; embedded image omitted from returned fields. Assert the stable fatal codes above.
- [x] Run `pnpm --filter './packages/chara' exec vitest run test/read.test.ts`; require a behavioral failure after the initial package harness is installed. A missing dependency alone is not the red test.
- [x] Implement byte-first decoding and an iterative bounded object walk. Use own-property-safe structures; never coerce arbitrary nested objects into diagnostic strings. Keep unknown non-image fields as data, flag unsupported ones, and distinguish fatal input failure from later field-level issues.
- [x] Build the four ESM entry points with esbuild and generate declarations with TypeScript. The main entry exports only reader/inspection contracts and their small helpers; optional entries may be introduced as their tasks land.
- [x] Re-run the reader tests, package type-check, and a main-entry import with a fetch spy that asserts zero calls. Commit the reader/configuration paths only.

**Exit:** An independently imported package can read supported character documents locally with bounded behavior.

## Task 2: Normalize appearance, equipment, and metadata without losing raw values

**Future files:** `src/inspect.ts`, `models.ts`, `types.ts`, `field-spec.ts`, `index.ts`; `test/inspect.test.ts`, `models.test.ts`.

**Interfaces:** Consumes `CharaDocument`; produces `inspectChara`, `CharaInspection`, `EquipmentModel`, `EquipmentResolveInput`, and `modelKey`.

- [x] Write failing cases for the producer field matrix: absent/null/zero/false; tribe/race spelling differences; unknown identity fields; malformed individual fields; both facewear representations; worn/empty/missing/invalid gear; both dye channels, including zero; and a color error that does not hide valid equipment.
- [x] Pin model arithmetic: armor `{base:361, variant:5}` gives `328041`; weapon `{set:634, base:19, variant:1}` gives `4296213114`. Check slot mapping, both rings, uint16 lane boundaries, and rejection-with-diagnostics of fractional/negative/out-of-range lanes rather than silent flooring.
- [x] Run `pnpm --filter './packages/chara' exec vitest run test/inspect.test.ts test/models.test.ts`; confirm the new cases fail for the missing behavior.
- [x] Implement normalization from field presence and verified shapes. Preserve declared producer labels as metadata, not trusted routing. Retain exact extended values before conversion and field-level diagnostics; do not swap eyes, discard all-zero values, or infer active colors in this layer.
- [x] Re-run Task 1 plus these suites and type-check. Confirm inspection is JSON-serializable and leaves the source document unchanged. Commit this task's paths.

**Exit:** A consumer can inspect complete or partial character data without loading palettes or calling an API.

## Task 3: Extract versioned palette data and an injectable provider

**Future files:** `src/palettes/*`, four palette JSON files, `scripts/build-palettes.ts`, `verify-palettes.ts`, `test/palettes.test.ts`, `docs/data-provenance.md`.

**Interfaces:** Produces `PaletteProvider`, `PaletteRequest`, `PaletteColor`, dataset metadata, and `createDefaultPaletteProvider`.

- [x] Write failing checks against reviewed creator/shader sample entries from Task 0; ensure shared and tribe/gender-dependent tables resolve independently and invalid/missing coordinates return null. Test lazy import, concurrent-load deduplication, and retry after a failed load.
- [x] Run `pnpm --filter './packages/chara' exec vitest run test/palettes.test.ts`; verify the expected missing behavior.
- [x] Extract only palette access, not dye matching or the full character-color service. Port the existing generator into an explicit local-file tool that accepts a maintainer-supplied `human.cmp`; ordinary package builds use committed generated tables and never require a game installation.
- [x] Store creator and shader tables separately. Embed their recorded provenance and content hashes; publish metadata with `gameVersion: null` where the source game version cannot be substantiated. Bundle JSON into portable ESM chunks so Node consumers do not need special JSON import handling.
- [x] Run the palette suite and `pnpm exec tsx scripts/verify-palettes.ts`; compare known entries, table sizes, and hashes to the reviewed baseline. A generator round trip requires the actual source file and must not be claimed if unavailable. Commit the data/provider/provenance paths.

**Exit:** Indexed swatches can be obtained locally through either the bundled provider or a host-supplied provider.

## Task 4: Interpret appearance swatches with explicit evidence

**Future files:** `src/appearance/*`, `test/appearance.test.ts`, `fixtures/expected/appearance.json`.

**Interfaces:** Consumes `CharaInspection` and `PaletteProvider`; produces `resolveAppearance`, `AppearanceOptions`, `AppearanceInspection`, and the versioned default policy.

- [x] Write failing cases for eyes/heterochromia, tribe/gender skin and hair, highlights disabled, face paint disabled, dark/light palette ranges and invalid gaps, Hrothgar fur-pattern versus lip color, lip alpha zero/absent/intermediate, and missing tribe/gender.
- [x] Add creator-versus-shader disagreement, square-root decoding of verified gamma-2.0 extended values, absent/false extended-valid flags, custom off-grid values, float-only slots, and evidenced crossed-eye cases. Preserve all-zero values as stored evidence; ambiguous legacy semantics must be reported instead of silently identifying a producer or active color.
- [x] Run `pnpm --filter './packages/chara' exec vitest run test/appearance.test.ts` and confirm meaningful failures.
- [x] Port the minimal conversion/DeltaE/compositing math and resolution policy. Keep palette, shader, and extended colors separately visible. Record why a display interpretation was selected, why a slot is inactive/unresolved, and any eye-pair correction; corrections never overwrite parsed fields. Label lip composites as derived previews.
- [x] Re-run against independently reviewed expected swatches, including indices/floats on either side of the 6 DeltaE threshold and the 1 DeltaE eye-match tolerance. Test injected providers as well as bundled data. Commit the appearance paths.

**Exit:** Consumers can display understandable appearance swatches without an equipment service or dye database.

## Task 5: Build a portable XIVAPI client and versioned cache contract

**Future files:** `src/xivapi/types.ts`, `client.ts`, `query.ts`, `cache.ts`, `index.ts`; `test/xivapi-client.test.ts`.

**Interfaces:** Produces the injected transport, upstream row types, cursor handling, and `ResolutionCache` consumed by Task 6. Shared options are `XivapiOptions` from the API contracts.

- [x] Write mocked failing tests for properly encoded grouped slot/model queries, decimal weapon keys, deduplication, language fields, version/schema forwarding, cursor iteration, per-operation page bounds, malformed JSON/rows, timeout, cancellation, 429/503, and explicit incomplete results.
- [x] Add request-minimization tests: only lookup identifiers/version/schema/fields reach URLs or request bodies; no source document metadata, appearance, or stain IDs. The default browser transport must not set a forbidden `User-Agent` header; server hosts may customize their injected fetch.
- [x] Run `pnpm --filter './packages/chara' exec vitest run test/xivapi-client.test.ts`; verify the new failures.
- [x] Implement on standard fetch/URL/AbortSignal primitives, with no Hono or Cloudflare imports. Coalesce repeated lookups, use the exact timeout/retry defaults above, and make external failures inspectable. Treat caller cancellation distinctly from service unavailability.
- [x] Namespace cached rows by endpoint, resolved game version, schema/field shape, locale selection, and slot/model or facewear key. Cache complete empty results only; never turn a truncated/failed response into a negative cache entry. Refresh changing `latest` aliases without reusing a previous version's data; skip cache storage when no immutable version can be established. Test positive/negative TTL expiry and alias changes with Vitest's fake clock.
- [x] Re-run the client suite and runtime import checks. Document that direct browser access still needs a real browser smoke test in Task 7; the planning session did not verify CORS because the terminal could not resolve the upstream hostname. Commit these paths.

**Exit:** A host can query and cache XIVAPI data with controlled, replaceable transport and no character upload.

## Task 6: Resolve equipment candidates, off hands, and facewear

**Future files:** `src/xivapi/resolve.ts`, `types.ts`, `index.ts`; `test/resolution.test.ts`, `fixtures/expected/equipment-rows.json`.

**Interfaces:** Consumes Task 2 model identities and Task 5 upstream/cache contracts. Produces `createXivapiResolver`, `EquipmentResolver`, candidate types, and `EquipmentResolution`.

- [x] Write failing cases for unique/ambiguous armor, duplicate ring models, weapon triples, shields, a quiver/focus/fist pair matched through its main hand's `ModelSub`, a copied main-hand model, facewear, and a model with no item row.
- [x] Add partial-page, outage, missing rule-field, modded/NPC key, and main-hand-context cache cases. Only a complete successful search may produce `notFound`; partial or unavailable lookups keep those statuses even when no candidate has arrived.
- [x] Run `pnpm --filter './packages/chara' exec vitest run test/resolution.test.ts`; confirm the cases fail for the expected behavior.
- [x] Extract matching independently from transport. Re-associate rows by slot and packed key, resolve off-hand relationships using the main-hand context first, and return stable item-ID-ordered candidates. Return all retrieved candidates; do not copy the existing UI's eight-alternate cap or acquisition-dependent preferred-item rule into the generic API.
- [x] Preserve retired/unobtainable rows with any substantiated metadata instead of silently removing them. Keep missing wear/dye/glamour fields unknown. Acquisition text, preferred-twin policies, and regional-name enrichment remain optional future extensions.
- [x] Re-run Tasks 5–6 and type-check; compare reviewed rows to expected slot/model relationships. Commit the resolver paths.

**Exit:** A standalone consumer can resolve equipment while retaining ambiguity, missing data, and upstream failure states.

## Task 7: Create the reference website using only public exports

**Future files:** `apps/demo/*`, three anonymized public examples and manifest; Playwright inspection/resolution suites.

**Interfaces:** Consumes `readChara`, `inspectChara`, `resolveAppearance`, `createDefaultPaletteProvider`, and `createXivapiResolver`; produces a static demo artifact.

- [x] Write browser scenarios for each producer, partial files, stored-value expansion, appearance swatches with source labels, equipment/dye IDs, multiple item candidates, and keyboard-accessible file selection. Assert imported HTML-like names render as literal text.
- [x] Add API-failure and overlapping-file scenarios: resolve file A slowly, select file B, then finish A; every displayed result must belong to B. An invalid replacement file preserves the previous valid inspection and reports the rejection. Refuse non-`.chara` names and over-limit files before reading; a renamed pose still fails content recognition.
- [x] Run `pnpm --filter './apps/demo' exec playwright test`; confirm the missing behavior. Use mocked XIVAPI responses for deterministic automated tests, not a dependency on live upstream availability.
- [x] Implement a small responsive page with in-memory state, accessible status messages, and lazy optional-module imports. Display appearance/gear immediately; enrich equipment asynchronously. Abort superseded requests and use generation checks to prevent late updates. Render stored values without offering edit/write controls or decoding embedded images.
- [x] Run the browser scenarios and a production build/preview. Perform a separately recorded live browser lookup with a known model and verify that only identifiers leave the page. Check browser CORS, cancellation, returned version, and icons. If direct access is blocked, record the limitation and resolve proxy scope with the maintainer before adding any backend or claiming a working live demo.
- [x] Commit the demo/example paths. Do not deploy the preview or choose a public domain automatically.

**Exit:** The website demonstrates the installed library's read/inspect/swatch/resolve flow, including clear degraded states. Live integration remains unverified until the browser lookup succeeds; a recorded transport limitation is a pending item, not a passing live gate.

Task 7 evidence: [demo validation](../demo.md). Direct localhost Chromium CORS, returned upstream identities and icons passed a separate synthetic live check; cancellation/stale results passed controlled-response browser tests. No deployment was performed.

## Task 8: Verify distribution, document usage, and prepare review artifacts

**Future files:** `test/package.test.ts`, `test/runtime/*`, `scripts/test-package.ts`, `docs/api.md`, `migration.md`, root README/notices/contribution guidance, package exports, `.github/workflows/ci.yml`.

**Interfaces:** Consumes all five public entry points, including the approved `/dyes` follow-up. Produces an installable package artifact, static demo artifact, compatibility statement, and migration notes.

- [x] Add installed-tarball tests for JavaScript and TypeScript consumers of all five entry points. Run parsing, bundled palette lookup, swatch interpretation, and mocked resolution in Node and a browser; run the shared smoke through module Web Worker and local Wrangler/workerd without deployment. Check declarations and JSON-free ESM loading outside the workspace. Keep Node and Wrangler dependencies in development tooling only.
- [x] Assert the main-entry bundle contains neither palette tables nor network client code, importing any entry has no network side effects, and the package has no runtime dependency on this monorepo or server/browser-specific globals. Verify packed files exclude fixtures with private data, local paths, raw game files, and build credentials.
- [x] Run the complete gates using the actual root commands: `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm test:package` (includes production builds, pack, installed consumers), `pnpm verify-fixtures`, `pnpm verify-palettes`, `pnpm verify-dyes`, and `pnpm audit`. Record exact commands, runtime versions, pass counts, and live-smoke limitations.
- [x] Document minimal parse/inspect, swatches, and XIVAPI examples; supported producer snapshots; field/presence semantics; input-policy overrides; appearance interpretation; candidate ambiguity; upstream failure behavior; and palette regeneration. Carry code/source notices and separate data provenance.
- [x] Add a CI workflow for those local/mocked checks and artifact preparation, with no automatic publishing/deployment. Prepare a reviewable diff and changelog for the new project; the maintainer separately authorizes release destinations and publication.

**Exit:** A fresh consumer can install and use the package independently, and the demo can be built from public exports with documented compatibility and evidence.

Task 8 evidence: [distribution/runtime validation](../security/distribution-validation.md). CI configuration is implemented and locally linted; hosted results must be recorded after the workflow is run on GitHub. Real producer ground truth, licensing/identity/reporting and release/hosting gates remain open.

## Later follow-up: migrate XIV Dye Tools consumers

This is outside the standalone MVP build and needs a refreshed, separately authorized change in this monorepo after the library API is stable.

- Retain or adapt the existing core exports while web-app and bot-logic migrate; do not remove published APIs casually or create a new package-to-core dependency cycle.
- Keep host input limits, shared character session, localization, theme/modal/toast services, collections, and community submission behavior in their current hosts.
- Decide whether api-worker adopts the new transport-independent resolver while retaining its own routes/cache and acquisition/regional enrichment. Preserve old response compatibility and Discord service-binding behavior.
- Re-check generated-data consumers, including Discord font generation reading API item-name files; moving those datasets is not part of this extraction.
- Validate parser/swatch/equipment parity against existing fixtures before replacing a consumer; explicitly review intentional differences in partial-file acceptance, raw-value preservation, candidate exposure, and historical color policy.
- At migration time, run the full monorepo gates and affected web/bot integration suites, assess published API semver, and prepare the ordinary version/changelog/PR work. Do not publish packages, deploy, merge, or push to `main` automatically.

## Completion criteria for a future MVP

- [ ] Default exports and any supported selective export modes from all three producers have reviewed expected inspection results; unavailable modes are documented. A purely equipment-only producer export is not required. Synthetic partial-document tests remain separate contract coverage.
- [x] Appearance swatches identify their palette/extended source and surface inactive, ambiguous, and unresolved cases honestly.
- [x] Local parsing and swatches work without XIVAPI; equipment requests exclude document contents, names, appearance and dyes. Model identifiers and ordinary connection metadata can still be distinctive.
- [x] Equipment resolution preserves candidates and distinguishes missing, partial, and unavailable answers.
- [x] The demo uses public package exports, handles stale work, and has a successful recorded live lookup through the verified direct transport or a separately approved alternative. Any unresolved transport limitation keeps this item open.
- [x] Installed-package and browser/Worker runtime checks pass; source/data provenance and compatibility limits are documented for the pinned matrix.
- [x] Editing/writing, full reader UI extraction, GPOSERS/acquisition export, public service hosting, and XIV Dye Tools migration remain outside this MVP unless separately added.

The remaining fixture criterion requires reviewed redistributable real producer exports; synthetic field-shape fixtures and private aggregate corpus admission do not close it.

## Resume checklist

1. Obtain explicit direction to reopen implementation; approving or committing this plan alone does not authorize coding.
2. Confirm the `ffxiv-chara` checkout, npm identity, toolchain lock, license/notices, and the proposed defaults above. Demo deployment destination is required only before deployment.
3. Refresh source/upstream snapshots and compare the agreed MVP to this draft; choose execution method and resolve any changed interface contracts before Task 1.
4. Execute only the authorized tasks. Keep publication, deployment, and existing-product migration as separate decisions.

**Repository setup:** The initial commit contains only `README.md` and this plan, adapted from the XIV Dye Tools planning draft. References to existing implementation and research point to the pinned source snapshot. No library/demo code, tests, dependencies, package versions, generated data, or deployments are introduced. Implementation gates have not been run because implementation has not started.
