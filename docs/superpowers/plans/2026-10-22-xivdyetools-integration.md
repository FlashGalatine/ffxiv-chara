# XIV Dye Tools Integration Implementation Plan

> **For agentic workers:** Only after a subsequent explicit implementation request, use `superpowers:executing-plans` for inline execution, or `superpowers:subagent-driven-development` if the maintainer chooses delegation. Read the target repository's `AGENTS.md`, root `CLAUDE.md`, and affected units' guidance first. Steps use checkboxes for tracking.

**Status:** Planning only. Updated on 2026-10-22 to address all four review findings; the maintainer explicitly deferred implementation. All implementation checkboxes remain unchecked. This revision authorizes no source changes, dependency installation, commits, publishing or deployment.

**Goal:** Make XIVCharaKit the character-file reader and appearance interpreter used by XIV Dye Tools' web app and shared bot commands, while preserving its application features and host policies.

**Architecture:** Add a shared adapter in `@xivdyetools/core`, using `xivcharakit` for bounded reading/inspection and `xivcharakit/appearance` for color interpretation. Supply the existing creator/shader data through a host palette provider, and project results into a small application model. Keep dye matching/localization, sessions, equipment enrichment, game rules, acquisition data and exports in XIV Dye Tools.

**Tech stack:** TypeScript ESM, pnpm 11.17.0, Turborepo, Vitest, Vite/Lit, module Web Workers, and Cloudflare Workers. Follow the target's root Node floor (`>=22.13.0`) for development; separately validate the published core package's advertised Node floor (`>=18.0.0`).

**Spec:** [Consumer migration brief](../../../migration.md), [library API](../../api.md), [appearance semantics](../../api.md#appearance-interpretation-xivcharakitappearance), and the compatibility decisions below.

**Execution root:** a local checkout of `FlashGalatine/xivdyetools`. All task paths refer to that repository unless explicitly prefixed `XIVCharaKit:`. This plan is stored in the library repository for handoff; its Markdown reference links resolve relative to this document. An executor can read it here while working in the target repository; copying files is not required.

## Baseline and scope

Reviewed local sources on **2026-10-22**. The initial draft used target `d50927c2744887a1cabf232303bc622f511ef263`; the security review and this revision use target `0cf9d00c79f4d669fc76e72a0d39ecd46e071f69` on `main` and library `39b849fb585eb2bb7d31ce139593fab5afaeb530`. Both source checkouts were verified clean before this document edit. Recheck the actual worktree before implementation. No target files, dependencies, or deployments were changed while revising this plan.

| Component | Reviewed baseline | Relevant implementation |
| --- | --- | --- |
| XIVCharaKit | Local `0.1.0-beta.3`, source `39b849fb585eb2bb7d31ce139593fab5afaeb530` | Five public exports; eventual registry artifact/provenance remains an adoption gate; beta.2 is the historical comparison baseline |
| Core | `5.14.0` | `packages/core/src/services/chara/{chara-parser,chara-resolver,chara-models,chara-shader-colors}.ts` |
| Web app | `5.15.5` | `chara-file-loader.ts` → shared `CharaSessionService` → Swatch Matcher / Glamour Reader |
| Shared bot logic | `4.10.0` | `packages/bot-logic/src/commands/{swatch,glamour}.ts` |
| Discord worker | `5.8.15` | Shared attachment guards and command handlers |
| API worker | `0.20.1` | `/v1/chara/resolve`, icon proxy, regional names, acquisition and twin selection |

The integration target is **exactly `xivcharakit@0.1.0-beta.3` once published and verified**, not a floating `next` tag. Review its eventual registry artifact against its own CI release manifest before installation. The historical beta.2 integrity is `sha512-i0Kno7HGUeBs9h9pPVCVxanofG2tXb/O125/bB7tCjqj4qrYmXhmoF0sRhcRbBrg60veMCoUL7Tg0iUpUsOauw==`; it cannot substitute for beta.3 verification. Beta.3 ignores the lip-color bit of `Mouth` (audit finding F096); beta.4, prepared and not published, reads it and reports the lip of the committed real exports as inactive (`lipDisabled`). Whether the target moves to beta.4 once it is published, verified and aged is the maintainer's decision.

Beta.2 is a historical comparison baseline, not a promise of complete host parity. The host accepts the legacy `Helion` tribe alias, while published beta.2 lists `Helions` without that alias. The beta.3 candidate fixes this gap with inspection and actual-palette regressions, following the 2026-10-22 producer-source refresh. Publish and verify beta.3 before consumer adoption; preparing this candidate does not change the published beta.2 artifact. Any additional blocking gap found during comparison requires its own reviewed library change and exact version pin.

## Review findings addressed by this revision

Review basis: the `2026-10-22-chara-integration-plan-security` audit of this plan, which the maintainer keeps locally and which is not part of either repository. Its original snapshot and findings remain historical evidence. The following requirements address the findings in the plan; they do not mark the unimplemented fixes or acceptance gates complete.

| Finding | Required plan change | Owner / acceptance |
| --- | --- | --- |
| FINDING-001 — development save logs include imported names | Remove labels from both save components and the shared collection service's creation/lifecycle logs. | Task 5: real save-path canaries with development logging enabled, including collection creation/deletion and reimport. |
| FINDING-002 — file-card-only labels contradict local saved names | Preserve explicit local display/save/backup exceptions, with separate 256-unit session and 50-unit saved-name limits. | Data-flow policy below and Task 5: local fallback persists; community naming remains typed-only; prohibited sinks stay empty. |
| FINDING-003 — unknown activation may still have a resolved color | Preserve color/activity evidence, but exclude unknown activation from automatic matching using shared `matchHex`. | Tasks 1, 3, 4, 5 and 6: tuple, protocol, preview/warning and matching assertions. |
| FINDING-004 — malformed collection import logs names in production | Validate descriptions before string operations and remove names/raw exceptions from import-error logs. | Task 5: production-mode malformed-import and forced-error canaries; later valid records still import. |

FINDING-004 is an existing adjacent collection-import defect, not a direct character-parser defect. Its fix is included in Task 5's bounded collection-service work and may be completed earlier through a separately authorized web-app change. Neither path is authorized by this planning revision.

## Global constraints

- Keep `MAX_CHARA_FILE_BYTES = 8_192`. Check browser `File.size` before reading and Discord metadata plus actual streamed bytes before parsing. Pass `{ maxBytes: MAX_CHARA_FILE_BYTES }` to the new reader adapter as a second boundary. Do not lower shared image-upload limits or inherit the library's 8 MiB default.
- Honor `minimumReleaseAge: 1440` and the existing `allowBuilds` policy. Wait for an eligible package release; do not add a standing exception or install-script permission for this integration.
- Original library code is MIT; retain its complete code license, third-party notices and Square Enix attribution/non-affiliation language. Game-derived data has separate notices. Do not redistribute raw `human.cmp`.
- Import through public exports only. Runtime imports are `xivcharakit` and `xivcharakit/appearance`; `PaletteProvider` types can come from `xivcharakit/palettes`. The first migration does not import the bundled default palette provider, `/dyes`, or `/xivapi` into application code.
- Preserve the existing offline dye database and all six locales: `en`, `de`, `fr`, `ja`, `ko`, `zh`. A Stain ID is not an item ID; facewear colors are not stains.
- Keep the browser's API-worker boundary and CSP. The reference demo's direct XIVAPI transport is not the host integration architecture. Retain the host's current lookup trigger and identifier-only request allowlist.
- Raw documents, embedded image payloads and arbitrary unknown fields must not enter sessions, telemetry, logs, caches, requests, SVG/PNG cards or exports. Explicitly projected nickname/file labels may enter only the local flows defined below. Bot output keeps neutral localized titles.
- Preserve the existing user-initiated local collection naming and backup behavior. Imported labels must never prefill a community name or enter logs, telemetry, resolver bodies, bot output or glamour-list exports. Fixed error codes and operation/count-only logs apply in development and production.
- Preserve published `parseCharaFile`, `resolveCharaColors`, `ParsedCharaFile`, `ResolvedCharaCharacter`, model helpers and `CharacterColorService` contracts during this additive migration. Add new entry points; removing or changing legacy APIs requires a separate semver decision.
- No existing application feature is removed: nearest-dye matching, grid links, shared sessions, twin selection, in-game rules, acquisition lines, regional names, GPOSERS/Markdown export and icon proxy remain host responsibilities.
- Refresh the latest official Brio, Ktisis and Anamnesis release/export sources before implementation compatibility claims, following XIVCharaKit's `AGENTS.md`. Record source review separately from actual producer-export tests. Future Evercold free colors remain a later format task, based on actual exports.

### Local label and data-flow policy

| Destination / action | Allowed data and limits |
| --- | --- |
| Worker projection, shared in-memory web session and file card | Explicit local nickname/producer labels, at most 256 UTF-16 code units each; cap the browser filename to the same limit in the loader. Render as text. No raw inspection/document is retained. |
| User-initiated local character/palette save and saved-record display | Preserve the current fallback order: typed palette name where available, then nickname, filename and localized default. Saved names remain at most 50 UTF-16 code units including any uniqueness suffix. No automatic persistence merely from importing a character file. |
| User-requested collection backup/export and reimport | Preserve deliberately saved record names under the same collection constraints. This is the existing collection JSON feature, distinct from the glamour-list export. No raw character document or new imported metadata is added. |
| Community preset form/submission | Empty default, with a separately typed name required. Never read the local fallback name into this form or its outgoing payload. |
| Glamour-list / GPOSERS / Markdown output; bot SVG/PNG, titles, embeds and exports | Existing game/item/dye information and neutral localized headings; no imported nickname, filename, author or arbitrary metadata. |
| Logs and errors, in development and production | Fixed operation/error codes and bounded counts only; no labels, collection names, raw exceptions/messages, documents or unknown values. User-facing messages use locale keys. |
| Analytics and equipment resolver requests | Preserve allowlisted producer-family/outcome telemetry and validated model/facewear identifiers respectively; no labels or raw document fields. |

These local save/backup exceptions preserve existing behavior and the web Privacy Guide's disclosed on-device naming; they do not broaden public collection or transmission. The bot has no local-label exception. Test permitted persistence and prohibited disclosure together rather than deleting local names to make canaries pass.

## Review focus

1. Partial files and malformed fields must not fabricate a complete appearance, an undyed channel, or an empty equipment slot. Task 3 owns these assertions.
2. Inactive lip alpha, the eye-pair correction, unavailable shader data and unknown activation must retain distinct meanings. Tasks 1–3 pin the evidence and matching policy; Tasks 5–6 pin previews, warnings and eligible matches.
3. A clear, refused replacement, delayed read or delayed worker result must preserve the intended session and lookup consent. Tasks 4–5 own these assertions.
4. New inspection metadata and existing local-save labels must not escape through logs, bot titles, error text, telemetry, glamour lists or resolver payloads. Task 5 includes shared collection lifecycle and malformed-import errors in both logging modes; Tasks 3 and 6 own projection/bot assertions.
5. A shared core dependency must not load duplicate palettes, trigger network activity on import, or break installed ESM/Node/Workers consumers. Tasks 2 and 7 own these assertions.

## Ownership and decisions

| Responsibility | Owner after integration |
| --- | --- |
| JSON admission, field states, enum normalization, model evidence | XIVCharaKit |
| Gamma-2 decoding, creator/shader comparison, activation, lip composition, eye correction | XIVCharaKit appearance interpreter |
| Existing palette storage and independent Swatch Matcher grids | `CharacterColorService` + `chara-shader-colors.ts`, accessed through a `PaletteProvider` |
| UI model, localization, nearest-dye matching and session lifecycle | XIV Dye Tools core adapter and application hosts |
| Equipment families, preferred twins, retired/acquisition metadata, ko/zh names, icons, KV | Existing API worker |
| Worn-slot filtering for application dye badges | Core adapter: only complete worn models, with valid nonzero channel IDs |

Use the existing host provider first. This avoids shipping a second palette corpus and leaves independent Swatch Matcher/public core APIs intact. Importing the library's default provider is a simpler alternative for a new application, but offers no initial benefit here. Replacing both the parser and the API worker in one change would combine unrelated transport, cache and product-policy migrations; defer that work.

### Compatibility decisions to encode before switching consumers

| Case | Current host behavior | Planned new import behavior / gate |
| --- | --- | --- |
| Partial equipment-only document | Rejected when no color key exists | Accept a supported character document; unresolved appearance stays explicit, and valid gear remains useful. This is an intentional app change with tests and release notes. |
| Unknown tribe/gender or malformed color | Some cases reject the whole file | Preserve valid independent equipment/appearance and show localized unresolved warnings. Do not guess missing context or silently coerce invalid values. Legacy APIs retain their old behavior. |
| `Au Ra` / `AuRa`, feminine/masculine enums | Host types use `AuRa`, `Male` / `Female` | Explicit normalized mapping to host types; use the canonical race, not a contradictory declared race. |
| Legacy `Helion` | Accepted as `Helions` | Fixed in the beta.3 candidate with regressions; verify the published beta.3 release contains it before adoption. Do not fork the producer parser inside the adapter. |
| Missing/fractional model lanes | Old parser defaults missing lanes to zero and floors positive fractions | Do not invent or floor lanes. Require complete uint16 models; omit incomplete/invalid models from lookup and show a bounded warning while retaining valid other slots. |
| Invalid dye or zero dye | Old parser emits positive finite dyes, even fractions; suppresses zero | Require uint16 channel IDs. Keep valid models usable; emit badges only for valid nonzero dyes on worn slots and retain a diagnostic for invalid channels, without calling them undyed. |
| Explicitly disabled highlight or face-paint control | Old parser treats missing controls permissively | Preserve explicit `active: false` and inactive interpretation; no automatic matching. This differs from unknown activation. |
| Missing/null/invalid highlight or face-paint control with a resolved color | Old host can treat missing controls permissively | Keep library `active: null`, `interpretation`, `displayHex` and `reason` intact. Show a localized activity-unknown preview/warning; set host `matchHex: null` so automatic matching, matched-color saves and appearance exports exclude it. Do not fabricate unresolved color or inactive status. |
| Lip alpha zero with extended data inactive | Old resolver makes the lip inert whenever stored alpha is zero | Follow library activation: inactive stored alpha must not suppress an indexed lip. Pin this corrected behavior in both web and bot tests. |
| Crossed eyes (every current Brio export) | Old resolver and library have distinct guard conditions | Use library correction only with its complete evidence and live extended data. Keep original fields out of output mutation; show the effective corrected preview. |
| Missing shader reference | Old resolver falls back to creator comparison | Remain unresolved; do not use creator color as a pretend shader reference. |
| Embedded image under 8 KiB | Current parser ignores a populated `Base64Image` | Preserve omission, including null/empty placeholders; do not introduce a new blanket image-field rejection. The byte cap still refuses large image-bearing files. |
| Duplicate keys, depth/node limits, unsafe numbers | Current native JSON behavior is less restrictive | Accept the library's bounded refusal, with fixed localized errors and prior-session retention. |

The comparison report must record each difference as preserved, intentionally adopted, or blocking. No unexplained difference may pass the consumer-switch gate.

## Shared interface contract

Create `packages/core/src/services/chara/chara-library-types.ts` with these additive exports. Existing types remain unchanged:

```ts
import type { AppearanceSlotInspection } from 'xivcharakit/appearance';
import type { Field } from 'xivcharakit';
import type { ResolvedCharaCharacter } from './chara-resolver.js';

export type ImportedCharaSlot = Omit<
  AppearanceSlotInspection, 'storedIndex' | 'storedExtended'
> & {
  index: number | null;
  indexState: Field<number>['state'];
  matchHex: string | null;
};

export interface CharaImportIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  path: readonly (string | number)[];
}

export interface ImportedCharaCharacter extends Omit<ResolvedCharaCharacter, 'slots'> {
  slots: ImportedCharaSlot[];
  issues: CharaImportIssue[];
}
```

New functions, exported from core's existing root barrel:

```ts
inspectCharaForTools(input: string | Uint8Array): CharaInspection;
createCharaPaletteProvider(colors: CharacterColorService): PaletteProvider;
resolveCharaForTools(
  inspection: CharaInspection,
  colors: CharacterColorService,
  dyes?: StainIdLookup,
): Promise<ImportedCharaCharacter>;
```

`inspectCharaForTools` calls the library reader with the 8,192-byte limit, then inspection. `resolveCharaForTools` consumes only reader-produced inspections, calls `resolveAppearance` with the host provider, and projects the result. It does not retain `document`, `fields`, `raw`, or `storedExtended` in the returned application object. Deduplicate issues by code/path/severity, cap at 64, and use the fixed `ISSUES_TRUNCATED` code. Diagnostic paths admit only known schema-field segments and bounded nonnegative integer indices, to at most 32 segments; replace unrecognized source keys with the literal `unknown`. UI copy comes from code maps, never the library's English message or arbitrary raw values.

Use the eight-slot order `leftEye`, `rightEye`, `hair`, `highlights`, `skin`, `limbal`, `lip`, `facePaint`. `displayHex` is preserved color-preview evidence; `lipComposite.hex` supplies the labelled lip preview when present. `effectiveExtendedHex` is corrected preview evidence; `extendedHex` remains the original decoded color.

The adapter computes the shared host matching policy once: `matchHex` equals `displayHex` only when `active === true`, the interpretation is neither `inactive` nor `unresolved`, and `displayHex` is non-null; otherwise it is null. Web and bot appearance matching, automatic matched-color saves and appearance exports use `matchHex`, never a fallback to `displayHex`. Equipment lookup and valid equipment-dye badges remain independent of appearance activation.

Unknown activation is separate from unknown color. For a synthetic provider returning `#808080`, `{"Highlights":0,"FacePaintColor":0}` yields `active: null`, `interpretation: 'palette'`, `displayHex: '#808080'`, `reason: 'activityUnknown'` and host `matchHex: null` for both slots. Preserve that preview with an activity-unknown warning. Explicitly disabled controls remain inactive, and unavailable color evidence remains unresolved; neither is rewritten to the unknown-activity state. Live extended colors may have another library reason while activation remains unknown, and still receive `matchHex: null`.

Producer/nickname are bounded to 256 UTF-16 code units in the adapter; the web loader separately bounds the filename before session publication. Retain the stricter 50-unit local collection-name limit and the data-flow policy above. Map valid normalized identity fields explicitly (`Au Ra` → `AuRa`, `Masculine` → `Male`, `Feminine` → `Female`). Project only complete worn models and valid positive facewear IDs. Preserve zero-versus-invalid channel semantics in diagnostics, even though the host's dye badge list intentionally omits undyed channels.

## Task 1: Establish compatibility and accept an exact dependency candidate

**Files:** `packages/core/package.json`, `pnpm-lock.yaml`; create `packages/core/src/services/chara/__tests__/chara-library-parity.test.ts` and `docs/research/2026-10-22-xivcharakit-integration.md`.

**Consumes:** The candidate's five published exports and existing reviewed host fixtures/tests. **Produces:** A reviewed exact version pin and a complete difference register that gates Tasks 3–6.

- [ ] Refresh target worktree/HEAD and package versions using its checkout rules; isolate implementation from other live sessions. Record the producer release/source refresh. Do not alter compatibility claims from stale source notes.
- [ ] Write comparison tests for all eight colors, both dye channels, worn/empty/incomplete gear, both Glasses shapes, identity aliases, activation, eye correction, dark/light lips, Hrothgar fur and all-zero extended blocks. Record unknown-activity exclusion from automatic matching as an intentional host change, separately from preserved library color evidence. Use explicit expected values, not a snapshot copied from one implementation.
- [ ] Run `pnpm --filter @xivdyetools/core exec vitest run src/services/chara/__tests__/chara-library-parity.test.ts --coverage.enabled=false`; before adding the dependency, expect an unresolved `xivcharakit` import.
- [ ] After beta.3 publication, once its registry artifact passes integrity/provenance review and the 24-hour release-age policy, install with `pnpm --filter @xivdyetools/core add --save-exact xivcharakit@0.1.0-beta.3`. Keep it a runtime dependency of core; downstream packages consume core's facade.
- [ ] Run the comparison test and classify differences against the table above. Verify beta.3 includes the checked-in `Helion` regression. Any other missing required alias is blocking: request a separately reviewed library fix/release, verify that new artifact and age, update the exact pin, and rerun. Do not weaken expectations to force a candidate through.
- [ ] Record the final candidate, test evidence and approved behavioral differences. Commit the dependency, tests and register together only after the gate passes.

## Task 2: Bridge existing palettes without duplicating data

**Files:** Create `packages/core/src/services/chara/chara-palette-provider.ts` and `__tests__/chara-palette-provider.test.ts`; reuse `CharacterColorService.ts` and `chara-shader-colors.ts`.

**Consumes:** `CharacterColorService`, `charaShaderHex`, library `PaletteRequest`. **Produces:** `createCharaPaletteProvider(colors): PaletteProvider` for Task 3.

- [ ] Write tests that request creator/shader colors independently, map `features` to `getTattooColors()`, and map all nine palette names. Race palettes must translate `Masculine`/`Feminine` to host genders; invalid/missing coordinates return null before loading data.
- [ ] Run the new file with core's focused Vitest command; expect failure because the provider does not exist.
- [ ] Implement the creator mapping through `getEyeColors`, `getHighlightColors`, `getTattooColors`, `getLipColorsDark/Light`, `getFacePaintColorsDark/Light`, `getSkinColors` and `getHairColors`. Shader requests use `charaShaderHex` only for its six supported palettes; unsupported light/face-paint shader tables return null.
- [ ] Return canonical hex, RGB tuple, exact request coordinates and `datasetVersion: 'xivdyetools-host-palette-bridge/1'` (a bridge identifier, not a game patch). Omit optional metadata until the host can substantiate its complete provenance contract; never borrow the bundled provider's 7.57 metadata for different source data.
- [ ] Verify unknown palettes, out-of-range indices, detached results and loader failure/retry. Confirm no runtime import of `createDefaultPaletteProvider` and no network calls. Run the provider and existing character/shader tests; commit when green.

## Task 3: Implement the shared reader and application projection

**Files:** Create `chara-library-types.ts`, `chara-library.ts` and `__tests__/chara-library.test.ts` under `packages/core/src/services/chara/`; modify `packages/core/src/index.ts` for additive exports.

**Consumes:** Task 1's accepted candidate and Task 2's provider. **Produces:** The shared interface contract above; old parser/resolver exports remain operational.

- [ ] Write tests for the exact new signatures and DTO shape. Include UTF-8 byte boundaries at 8,191 / 8,192 / 8,193 bytes, a multibyte string, image omission, prototype-shaped keys, duplicate decoded keys and structural refusals. Assert no import-time or parse-time network/storage calls.
- [ ] Pin the byte boundary with `expect(() => inspectCharaForTools('{"LEyeColor":0}'.padEnd(8_192))).not.toThrow()` and `expect(() => inspectCharaForTools('{"LEyeColor":0}'.padEnd(8_193))).toThrowError(expect.objectContaining({ code: 'INPUT_TOO_LARGE' }))`.
- [ ] Add projection tests for valid partial equipment-only input, malformed color plus valid gear, incomplete gear, empty-slot stains, second-channel-only dyes, missing/null/invalid/zero dyes, numeric enums and contradictory Race/Tribe. Assert raw document/image/name canaries are absent from serialized projected output except the explicitly bounded local labels.
- [ ] Test model lanes, facewear and dyes at 65,535 and 65,536, plus negative/fractional/string values. Add an unknown property-name canary inside a diagnostic path and assert the projection substitutes `unknown` rather than retaining that key.
- [ ] Add color assertions for inactive alpha zero, unavailable shader data, missing control flags, Hrothgar, unknown race, all-zero blocks, and live/non-live crossed eyes. Assert original versus effective eye color remains distinguishable and unresolved slots have `displayHex: null`.
- [ ] Pin `active / interpretation / displayHex / reason / matchHex` for absent, null, invalid, explicitly disabled and enabled highlight/face-paint controls, plus live extended highlights. Use the synthetic missing-control tuple above; assert `matchHex` is non-null only for confirmed-active resolved colors. Preserve the library evidence even when the host excludes a slot from matching.
- [ ] Run the new tests and observe missing-entry-point failures. Implement the two facade functions and application types, reusing the provider and library interpretation rather than reimplementing gamma, DeltaE, eye swapping or lip compositing.
- [ ] Verify valid dye badges still use `dyes.getByStainId`, with unknown stains returning `dye: null`. Keep the nearest-dye matcher outside the facade. Cap/deduplicate diagnostics and project fixed codes without English/raw messages.
- [ ] Run the new suite, Task 1 parity tests and all existing core chara tests. The legacy API tests must still pass unchanged. Commit the facade and projection tests.

## Task 4: Add a cancellable browser inspection service

**Files:** Create `apps/web-app/src/workers/chara-inspection.worker.ts`, `src/services/chara-inspection-protocol.ts`, `chara-inspection-service.ts`, and `src/services/__tests__/chara-inspection-service.test.ts`.

**Consumes:** Core's new facade and `ImportedCharaCharacter`. **Produces:** `inspectCharaBytes(bytes: ArrayBuffer): Promise<ImportedCharaCharacter>` and `cancelCharaInspection(): void` for the loader. Define a bounded `CharaInspectionError` with code `unreadable | workerFailed | timedOut | superseded`.

The protocol request is `{ type: 'inspect'; id: number; bytes: ArrayBuffer }`. Responses are `{ type: 'success'; id: number; result: ImportedCharaCharacter }` or `{ type: 'error'; id: number; code: 'unreadable' | 'workerFailed' }`. IDs are positive safe integers; only the active ID may settle the promise. The host synthesizes `timedOut` and `superseded`. Transfer `[bytes]` rather than copying the input buffer.

- [ ] Write tests for valid worker results, error/message validation, worker startup failure, timeout, transfer of bytes, replacement and explicit cancellation. Timeout is exactly `5_000` ms; a late result must never publish after cancellation.
- [ ] Run the focused service test and observe failure before implementation.
- [ ] Use `new Worker(new URL('../workers/chara-inspection.worker.ts', import.meta.url), { type: 'module' })`. Terminate each completed, failed, superseded or overdue worker; a Promise race alone is insufficient. A successful message contains the projected DTO, never the inspection/document.
- [ ] Worker-local code constructs `CharacterColorService`, reads/inspects bytes, resolves appearance through the host provider and looks up dye badges from the existing offline database. Validate responses before accepting them: exactly eight unique appearance slots, at most twelve unique models, 24 dye channels and 64 diagnostics, canonical hex or null, uint16 identifiers, 256-unit local labels and at most 256 KiB of serialized projected data. Reject a `matchHex` inconsistent with the shared activation/interpretation rule; test a non-null match on `active: null` and a match differing from `displayHex`. Cross-thread DTOs are a separate boundary.
- [ ] Run the focused tests and a production-build module-worker smoke. Verify failure permits the next import to retry; commit the isolated service before wiring views.

## Task 5: Switch web imports and render the new evidence states

**Files:** Modify `apps/web-app/src/services/{chara-file-loader,chara-session-service,collection-service}.ts`, `src/components/{chara-file-card,chara-ui,chara-sheet,glamour-block,glamour-list-actions}.ts`; `src/components/__tests__/{chara-sheet,glamour-block-palette-name}.test.ts`, `src/services/__tests__/{collection-service,collection-service-branches}.test.ts` and other affected existing tests; create `src/components/__tests__/chara-collection-privacy.test.ts`; update `src/locales/{en,de,fr,ja,ko,zh}.json` and `e2e/{swatch-chara-session,glamour-reader}.spec.ts`. Paths after the first entry are relative to `apps/web-app/`.

**Consumes:** Task 4's service, Task 3's DTO/matching rule and the local label policy. **Produces:** One shared in-memory session, localized unresolved/activity-unknown evidence, preserved deliberate local saves, and name-free save/import logging.

- [ ] Write loader regressions before switching: extension/size rejection before any byte read, two overlapping reads, replacement during worker work, clear during worker work, a refused replacement leaving an admitted pending import intact, and retention of the last valid session after an invalid import.
- [ ] Write view tests for all five interpretations, unknown/missing context, partial gear-only input and corrected eye preview. Unknown activation with a resolved color retains its preview and localized warning but contributes no matched-color result, automatic saved dye or appearance export. Distinguish it from inactive and unresolved states; unknown diagnostic codes use a localized generic fallback. Keep grid links only when a valid grid coordinate exists.
- [ ] Before editing save paths, add separate nickname and filename canaries through both real component saves and the real collection service; do not mock away `createCollection`. Capture logger and console calls with development logging enabled. Cover creation, deletion, duplicate-name handling, tombstoned reimport and unexpected per-record errors; none may disclose a label. Include a forced error whose message contains a canary so forwarding raw exceptions cannot pass unnoticed.
- [ ] Pin allowed local behavior alongside the privacy assertions: 256-unit session labels; existing fallback order; 50-unit saved names including uniqueness suffixes; explicit collection export/reimport retains saved names. Import alone must not persist a collection. Community submission starts with an empty name and cannot use nickname/filename/local fallback; network, telemetry, glamour-list and bot-output canaries remain prohibited.
- [ ] Add collection-description regressions in both development and production modes: absent/null means no description; strings are trimmed and retain the existing 200-unit maximum; number, boolean, array and object values are rejected per record before `trim`. A rejected record returns `skippedInvalid`, writes no collection and does not prevent a following valid record from importing. Direct runtime misuse of `createCollection` must return null rather than throw on a non-string description.
- [ ] Run the focused save/privacy and collection suites below before implementing these fixes; require failure on the current name-bearing logs and malformed-description path. Add a production-mode forced-exception case as well as validation rejection, so fixing the type guard alone cannot conceal a remaining name-bearing catch log.
- [ ] Run these tests to expose the old loader/type/state assumptions. Replace main-thread `file.text()` parsing with capped `file.arrayBuffer()` and the inspection service. Retain the loader generation check around both reading and worker resolution; clear invalidates pending reads as well as workers.
- [ ] Add `cancelCharaLoad(): void` to the loader: increment its generation and call `cancelCharaInspection`. Wire it into the file card's clear action before `CharaSessionService.setSession(null)`. A refused drop must not call it. Route/locale changes still preserve the shared session.
- [ ] Change session/view annotations to `ImportedCharaCharacter` / `ImportedCharaSlot`. Use `matchHex` for appearance matching/save/export candidates and preserve `displayHex` / labelled `lipComposite` for previews. Keep the existing exact/closest matching and offline database. Map diagnostic codes and the activity-unknown warning to literal locale keys in all six locale files.
- [ ] Keep normalized producer-only parse telemetry and fixed errors; do not log or send documents, diagnostics containing raw values, file names or nicknames. Preserve `chara-resolve-service.ts`'s host API, cancellation and cache behavior; test that only validated model lanes and optional facewear leave the browser.
- [ ] Remove name-bearing messages from `chara-sheet.ts`, `glamour-block.ts` and the shared collection service, including creation/deletion/reimport/error paths. Use fixed operation codes and bounded counts. Preserve local saved names; do not remove the local fallback or widen privacy promises to make the logging assertions pass.
- [ ] Validate imported descriptions before calling `createCollection` and guard that method's string operations for direct runtime misuse. Keep the per-record catch for unexpected failures, but emit only a fixed name-free message/failure code, without the raw exception or record. Preserve subsequent valid-record processing and existing error-code/localized UI behavior.
- [ ] Run `pnpm --filter xivdyetools-web-app exec vitest run src/components/__tests__/chara-sheet.test.ts src/components/__tests__/glamour-block-palette-name.test.ts src/components/__tests__/chara-collection-privacy.test.ts src/services/__tests__/collection-service.test.ts src/services/__tests__/collection-service-branches.test.ts --coverage.enabled=false`; require all tests to pass in both asserted logging modes.
- [ ] Run affected Vitest files, `pnpm --filter xivdyetools-web-app exec playwright test e2e/swatch-chara-session.spec.ts e2e/glamour-reader.spec.ts --project=chromium`, repeat those scenarios with `--project=mobile-chrome`, and `pnpm --filter xivdyetools-web-app run build:check`. Use mocks, not production security probes. Commit once the session and rendering gates pass.

## Task 6: Switch the shared bot commands without changing transport policy

**Files:** Modify `packages/bot-logic/src/commands/{swatch,glamour}.ts`, corresponding tests and `__fixtures__/chara-fixtures.ts`; affected `packages/bot-logic/src/i18n/locales/{en,de,fr,ja,ko,zh}.json`; verify existing `apps/discord-worker/src/utils/chara-attachment.test.ts` and `src/handlers/commands/{swatch,glamour}.test.ts`.

**Consumes:** Core facade and projected DTO. **Produces:** Existing `SwatchResult` / `GlamourResult` contracts, SVG/embeds and equipment-resolver payloads, backed by the library.

- [ ] Add tests for the new color states, partial valid gear, no useful swatches, zero versus missing dyes, unknown stains and the Task 1 semantic corrections. Reuse the unknown-activation tuples: previews/warnings preserve evidence, while `matchHex: null` contributes no appearance match or appearance export. Gear lookup and equipment dyes remain usable independently; an unknown-activity-only file follows the existing no-useful-swatches result with a localized explanation. Pin exact match/closest dye behavior independently of the parser.
- [ ] Add nickname/author/file-name/unknown-field canaries and assert none reach titles, SVG/PNG inputs, embeds, logs, callbacks or exports. Keep `/swatch`'s nickname stripping immediately after projection and `/glamour`'s existing allowlist destructuring.
- [ ] Run the focused command tests and observe the old-path behavior failures. Switch both commands to `inspectCharaForTools` → `resolveCharaForTools`; update winning-color helpers to use `matchHex` without falling back to preview colors. Add fixed localized unresolved/activity-unknown warnings without exposing English library messages. Do not change successful public result shapes.
- [ ] Preserve attachment extension, CDN host, redirect, timeout, declared-size and streamed-byte checks. Keep bot command invocation as the host's lookup action and the existing API-worker service binding. CF Worker synchronous parsing remains admission-bounded; do not claim a Promise timeout can preempt it.
- [ ] Run both shared command suites, bot locale-quality checks, attachment tests, Discord handler tests and a local workerd bundle smoke. Verify the Node-based Stoat consumer still builds through the transitive core change, without enabling new platform commands. Commit the bot migration.

## Task 7: Validate distribution, attribution and the release boundary

**Files:** `packages/core/{package.json,NOTICE,CHANGELOG.md}`, affected units' technical/layperson changelogs and versions, `docs/versions.md`, `docs/user-guides/web-app/glamour-reader.md`; create `apps/web-app/scripts/copy-chara-notices.mjs` and generated `apps/web-app/public/licenses/xivcharakit.txt`, wiring the copy explicitly into `apps/web-app/package.json`'s build command. Modify `apps/web-app/src/components/about-modal.ts`, its existing test and the six web locale files for the notice link. Update the target root/unit `CLAUDE.md` facts.

**Consumes:** Completed migrations. **Produces:** Reviewable release artifacts and a beta-first rollout checklist; this task does not grant merge, package-publish or deployment permission.

- [ ] Add a failing notice-generation regression as `apps/web-app/scripts/copy-chara-notices.test.mjs`; run it with `node --test apps/web-app/scripts/copy-chara-notices.test.mjs` and wire that command into the web test gate. Require both installed `dist/LICENSE` and `dist/THIRD_PARTY_NOTICES.md` texts to appear verbatim. Implement generation from the dependency resolved by `packages/core`, not a guessed hoisted path or an export the package does not expose. Record attribution in core's `NOTICE`; add a localized `/licenses/xivcharakit.txt` link in `about-modal.ts` and pin it in `about-modal.test.ts`.
- [ ] Verify an isolated packed-core consumer resolves the exact new runtime dependency and additive APIs, with no workspace alias/link leakage. Test the existing advertised Node 18 floor as well as current development Node and local workerd before retaining that claim. If a floor fails, stop for an explicit engine/semver decision.
- [ ] Run `pnpm turbo run build type-check lint test --filter=...@xivdyetools/core`, `pnpm --filter xivdyetools-web-app run build:check`, `pnpm dead-code:check`, `pnpm docs:check-versions` and `pnpm docs:check-links`. Run relevant repository script/workflow invariant gates under its current guidance. Do not solve failures by weakening budgets, coverage, reachability or locale gates.
- [ ] Inspect the produced web/Worker bundles: no default library palette tables, direct XIVAPI browser transport, raw samples/images, test canaries or unexpected Node built-ins. Compare startup/lazy chunk sizes and worker CPU/memory observations with the pre-migration baseline.
- [ ] Verify legal links and module-worker CSP on a local production artifact, then on an authorized beta deployment. Use synthetic files and controlled API errors; preserve the API worker's acquisition/twin/rule/regional behavior. Record real producer-fixture tests separately from synthetic/corpus aggregate checks.
- [ ] Bump core for its additive public API and runtime dependency, and version affected bot/app units for their changes under current release policy. Preserve old exported APIs and document the intentional new-import behavior. Publish shared packages only via the existing manual trusted-publishing workflow when authorized.
- [ ] Open a PR against `main` when requested. Require fresh CI and beta acceptance before production approval; merging target `main` can deploy production, so it is not a harmless documentation step. Roll back with a revert restoring the previous dependency/consumer path through the normal PR flow, not a public runtime parser toggle or a force push.

## Definition of done

- Web Swatch Matcher, web Glamour Reader, `/swatch` and `/glamour` use the accepted library facade; old published parser/resolver entry points still pass their contract tests.
- The compatibility register has no unexplained differences or blocking aliases; intentional appearance/partial-document changes have independent assertions and localized UX.
- 8 KiB admission, safe projected output, latest-selection/clear semantics, offline dye behavior, equipment API contracts and all six locales pass their gates.
- Existing character grids, matching, sessions, equipment twins/rules/acquisition, icons and GPOSERS/Markdown output retain their host behavior.
- Local file-card/session labels, user-initiated saved names and deliberate collection backups obey their explicit limits; community names remain typed-only. Name canaries are absent from development/production logs and every prohibited sink through the complete save/import lifecycle.
- Malformed descriptions are refused before string operations without logging names/raw exceptions or discarding later valid records. Both validation failures and unexpected-error branches pass production-mode regressions.
- Unknown activation preserves its color preview and localized warning, while `matchHex` excludes it from automatic appearance matching/save/export in web and bots. Protocol tests enforce the same rule.
- Installed-package/runtime, bundle, notice, CI and authorized beta checks are recorded. Production rollout follows a separate explicit release action.

## Follow-up projects, outside this first integration

1. **API-worker transport reuse:** Evaluate `xivcharakit/xivapi` behind `/v1/chara/*`, retaining preferred-twin/retired filtering, acquisition, ko/zh merging, icon proxy and KV/rate-limit contracts. Library `partial`, `unavailable` or `cancelled` must never be translated into the host's definitive null/missing-item result; cache only complete evidence with a new namespace. Budget library deadlines against the host's existing request deadline. This needs its own adapter design and tests.
2. **Broader XIVAPI offloading:** Revisit dye names, localization and build-time metadata using [the existing feasibility research](../../xivapi-dye-feasibility.md). Preserve offline core consumers and regional coverage until an explicit product decision changes them.
3. **Legacy API/data retirement:** Remove duplicate parser/resolver code and reconsider palette ownership only in a planned major core release, after external consumers have a migration path. `CharacterColorService` still serves independent grids, so replacing the chara pipeline alone does not make it dead code.
4. **Evercold:** Refresh actual game/producer export formats for eye/hair/skin free colors when available, update the library with permissioned regression fixtures, and upgrade the pinned consumer deliberately. Keep legacy palette support and avoid nearest-grid coercion of future direct colors.

## Draft review / execution handoff

The four findings are now mapped to explicit plan requirements and acceptance tests; no implementation gate is complete. Hold implementation until the maintainer explicitly resumes it. At that time, refresh the worktree/candidate baseline, review the intentional matching and local-label behavior, and choose execution under the target's agent guidance. This document update does not request a new chat, delegate implementation, install a dependency, commit changes, publish a package, or authorize production changes.
