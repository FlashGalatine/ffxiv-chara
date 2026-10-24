# Reader and inspection compatibility

The reader foundation reads and inspects JSON `.chara` documents. Optional palette and appearance entries now interpret source-labelled swatches without changing the stored evidence; the main reader/inspection entry still does not load palettes or resolve items. Producer names are untrusted metadata. A supported character field is required; a type label alone and pose-only files are rejected. Recognized fields may be null, malformed, or missing in selective exports; inspection reports those states independently.

## Reviewed format snapshots

Sources were refreshed on **2026-10-22** through the official GitHub release APIs and release-tag/default-branch sources. These are format references, not producer binaries run by this project. Source hashes and release commits are recorded in [the fixture manifest](../fixtures/manifest.json); no upstream implementation is included. Four previously supplied real default exports remain test-only fixtures with permission; their exact application versions are unconfirmed. See [producer fixture validation](producer-fixture-validation.md).

| Producer | Latest stable release | Default-branch source commit | Format source |
| --- | --- | --- | --- |
| Anamnesis | [v7.57.0.3](https://github.com/imchillin/Anamnesis/releases/tag/v7.57.0.3), release/source `3d635757758ea9bd4e6d6d515cd6724bfabaa299` | `3d635757758ea9bd4e6d6d515cd6724bfabaa299` | [CharacterFile.cs](https://github.com/imchillin/Anamnesis/blob/3d635757758ea9bd4e6d6d515cd6724bfabaa299/Anamnesis/Files/CharacterFile.cs), [glasses converter](https://github.com/imchillin/Anamnesis/blob/3d635757758ea9bd4e6d6d515cd6724bfabaa299/Anamnesis/Serialization/Converters/GlassesSaveConverter.cs), [customization enums](https://github.com/imchillin/Anamnesis/blob/3d635757758ea9bd4e6d6d515cd6724bfabaa299/Anamnesis/Memory/ActorCustomizeMemory.cs) |
| Ktisis | [v0.4.1.2](https://github.com/ktisis-tools/Ktisis/releases/tag/v0.4.1.2), release `6f0fcf04fef28119d00645e253e6fbe3eb65d337` | `551bb23f5726ecffd1426ee3b540caf34feab18a` | [CharaFile.cs](https://github.com/ktisis-tools/Ktisis/blob/551bb23f5726ecffd1426ee3b540caf34feab18a/Ktisis/Data/Files/CharaFile.cs) |
| Brio | [v0.8.0.12](https://github.com/Etheirys/Brio/releases/tag/v0.8.0.12), release `b510c82f60dd5cd0d85b64ef88e33878a6ef496a` | `3f6f8e174ea447916c3ea4b86fdbedf56689f9c1` | [AnamnesisCharaFile.cs](https://github.com/Etheirys/Brio/blob/3f6f8e174ea447916c3ea4b86fdbedf56689f9c1/Brio/Files/AnamnesisCharaFile.cs) |

The listed export definitions are byte-identical to the previous 2026-10-19 references. Serializer settings and relevant vector/color converters were also compared with those previous commits: Anamnesis `SerializerService` and vector/color converters; Ktisis `JsonFile`, `JsonFileSerializer` and numeric converters; Brio `JsonSerializer`, `JsonDocumentBase` and actor enums. The reviewed release-tag and default-branch files match. Their field names/types, save modes, enum declarations, version markers and serialization behavior require no additional format revision adoption in this change. Ktisis still declares its own `CurrentVersion = 1`; this is not a shared revision number for all three producers.

This is a source comparison, not new testing of these producer binaries or export modes. No newer prerelease appeared after the latest stable release in the recent official release listings checked. Existing real-export fixtures retain their recorded provenance; regression tests for the alias below use authored input. Additional binary or export behavior remains unverified.

### Legacy `Helion` alias

Beta.3, published on 2026-10-22, accepts the exact tribe spelling `Helion` as an alias for canonical `Helions` (tribe ID 13), preserving `raw: "Helion"` and the original document. Canonical race becomes Hrothgar, so existing skin/hair palettes and fur-pattern interpretation work through the normalized tribe. Canonical `Helions`, numeric tribe IDs and case-sensitive unknown-value handling are unchanged.

This alias preserves a legacy spelling already supported by XIV Dye Tools; it does not claim that the latest producers export it or introduce a new `.chara` revision. Published `0.1.0-beta.2` does not contain the fix; `0.1.0-beta.3`, published on 2026-10-22, does. Verify the published beta.3 artifact before adopting that exact version in XIV Dye Tools.

## Appearance semantics reviewed in source (2026-10-23)

The snapshots above pin the serializer files. Appearance interpretation also depends on files that give two stored fields their meaning. Those were reviewed on 2026-10-23 and are pinned in [the manifest](../fixtures/manifest.json) (`sources` and `producerCompatibilityReview.semanticReview`). This is **source review only**: no producer binary was run, no new export was made, and in-game rendering was not observed.

| Meaning | Anamnesis `3d63575` | Ktisis `551bb23` | Brio `3f6f8e1` |
| --- | --- | --- | --- |
| Lip color enabled | `EnableLipColor => Mouth >= 128` (`ActorCustomizeMemory.cs`) | The lip checkbox toggles `0x80` of `LipStyle` (`CustomizeEditorTab.cs`) | `LipColorEnabled => (LipStyle & _toggleMask) != 0`, mask 128 (`ActorCustomize.cs`) |
| Face-paint mirror flag | Raw byte, no flip handling found (`ActorCustomizeMemory.cs`, `CustomizeEditor.xaml.cs`) | `canFlip` for `Facepaint` edits `baseValue & ~0x80` and preserves the bit (`CustomizeEditorTab.cs`) | `RealFacepaint` strips and `FacepaintFlipped` tests bit 128 (`ActorCustomize.cs`) |
| Extended eye-color offsets | Left `0x40`, Right `0x50` (`ExtendedAppearanceMemory.cs`) | Not reviewed | Right `0x40`, Left `0x50` (`BrioHuman.cs`) |

**Lip color.** All three producers use bit `0x80` of `Mouth`. Policy version `1.0.0` ignored it and treated every lip index as enabled; version `1.1.0` treats a clear bit as a disabled lip. All four committed real exports store `Mouth` 2, so the bit is clear in each.

**Face paint.** Bit `0x80` of `FacePaint` is a mirror flag in Brio and Ktisis, and Anamnesis passes the raw byte through, so a mirrored export can store 128 or more. Policy version `1.0.0` treated any non-zero value as paint present, so `FacePaint` 128 (no paint, mirrored) showed a face-paint swatch; `1.1.0` looks at the low seven bits. Anamnesis' own handling was only searched in the files listed above, and no export with `FacePaint` of 128 or more is committed.

**Eye colors, Brio v0.7.2 and later.** Brio's shader block was reordered by the 7.5 update (commit `5bec2d07`, 2026-04-30; tag `v0.7.1.2` has Left `0x60` then Right `0x70`, tag `v0.7.2` has Right `0x40` then Left `0x50`). The committed real Brio export is consistent with a crossing: each extended eye color equals the opposite eye's shader color. The `HISTORICAL_EYE_PAIR_SWAP` correction, named when it was thought to be a legacy quirk, therefore corrects current Brio output; its public identifiers are unchanged. It swaps only when both eyes land on the opposite shader, never by producer label. With a custom color on one eye the crossing cannot be confirmed: the colors stay as stored (possibly mirrored) and the result carries an `EYE_PAIRING_UNCONFIRMED` warning. Eyes that share an index cannot be detected.

Unverified: pre-7.5 Brio exports (expected uncrossed, not tested against a real export here), fresh Brio exports that carry a custom eye color (the regression test edits the committed real export), and how any producer renders these fields in game.

### Extended colors by producer (source review, 2026-10-24)

Extended colors change the result only when `IsExtendedAppearanceValid` is true ([API](api.md#appearance-interpretation-xivcharakitappearance)). The producers differ in whether they ever write it:

| Producer | Writes extended colors | Writes `IsExtendedAppearanceValid` |
| --- | --- | --- |
| Anamnesis `3d63575` | Yes, from its live extended appearance (null values omitted) | **Never.** `CharacterFile` and `FileBase` have no such property, and a code search of the repository for the flag finds nothing. Applying a file re-applies any non-null color. |
| Ktisis `551bb23` | No: the writer carries no extended block | Not applicable |
| Brio `3f6f8e1` | Yes | Yes, as a computed value: true when any extended color is present (`AnamnesisCharaFile.cs`) |

So off-grid and extended-only colors, live lip opacity and the eye-pair correction can only happen for Brio-shaped files. For an Anamnesis export the stored block is read as inactive evidence: the swatch is the indexed palette color with reason `extendedInactive`. The unmodified Anamnesis export with the flag added agrees with its palette colors on all six slots (distance 0), so the stored block is live captured data that the gate holds back. The lip shows it most, for a race whose lip is a palette index (every race but Hrothgar): with the lip-color bit (`0x80`) of `Mouth` set, an Anamnesis file shows the palette lip, where a Brio-shaped file whose stored opacity is 0 shows no lip (`noLip`) and one above 0 a composite. With the bit clear, as in all four committed exports (they store `Mouth` 2), both producers' files show `lipDisabled` and the gate has no effect on the lip; the zero-opacity file with the bit set is an authored edit of the real export, in the regression test. A Hrothgar's lip is a fur pattern and the bit does not matter: a stored lip color is held back without the flag and shown with it. The audit of 2026-10-23 found that XIV Dye Tools' own resolver applies a lip opacity of 0 whatever the flag says (not rechecked here), so adopting the library as it stands would change that for Anamnesis files whose lip-color bit is set.

This is a deliberate, tested policy (`appearance.test.ts`, `producer-exports.test.ts`); a change to it, such as a "presence" mode that matches Brio's own definition of the flag or an `unknown` activity state, has to ship as an explicit option or a policy-version bump, not as a new default.

Brio writes `SkinGloss`, `HairGloss` and `BustScale` as `null`: they default to `null` in its `AnamnesisCharaFile`, its writer never sets them and its serializer keeps nulls, and the committed export shows it. An Anamnesis export has no gloss fields and writes `BustScale` as a vector. Nothing in the library depends on this and it has not been validated as a way to tell producers or versions apart.

### Files pinned for what a field means (2026-10-24)

The format snapshots above pin the serializer files. These further files give the stored values their form and meaning, or are what a stated limit rests on, and are pinned in [the manifest](../fixtures/manifest.json) (`sources` and `producerCompatibilityReview.pinReview`), each with the SHA-256 of the raw file at the pinned commit, so that a refresh sees a change in them:

| Producer | File | What it defines |
| --- | --- | --- |
| Anamnesis `3d63575` | `FileBase.cs` | The metadata fields and the embedded image field |
| | `Color.cs`, `Color4.cs` | The color types the color converters read and write |
| | AetherToolsWpf `Math3D/Extensions/VectorExtensions.cs` (commit `8221958`, Anamnesis' `Lib/XivToolsWpf` submodule) | The vector text format and its separator |
| | `VersionConverter.cs` | `Version` as text, or a Ktisis-style integer read as `Ktisis_<n>` |
| | `ObjectTypes.cs` | The `ObjectKind` values |
| | `Actor/Pages/CharacterPage.xaml.cs` | Every export saves all sections; "Save with metadata" opens the metadata editor |
| | `Files/FileMetaEditor.xaml.cs` | Browsed images above 6 MiB are refused; a clipboard image has no check |
| Ktisis `551bb23` | `CustomizeContainer.cs` | The Gender and Age enum names |
| | `EntityCharaConverter.cs` | The writer of the file |
| | `FileDialogManager.cs` | Where the file is written |
| Brio `3f6f8e1` | `Files/Converters/VectorConverters.cs` | Vectors as comma-and-space separated invariant-culture decimals |
| | `Capabilities/Actor/ActorAppearanceCapability.cs` | `ExportAppearance` writes the whole file; the import options apply to import only |

The reader splits a vector on a comma and trims the whitespace around each part (a part may have at most 64 characters), so it accepts ", ", "," and exponent notation such as `1E-05`; any other separator (a semicolon, a plain space between numbers) makes the color `INVALID_FIELD`, and every extended color of a file would be lost. That is why the vector and color converters are pinned. A renamed enum value upstream (for example `Age.Old`) would otherwise appear only as `UNSUPPORTED_VALUE` on real files.

### Producer limits

- **Embedded images.** Anamnesis' metadata editor accepts browsed images up to 6 MiB and clipboard images without a limit. A 6 MiB image is 8,388,608 base64 characters, about 8.39 MB before any other content, and about 9.05 MB when `+` is written as `\u002B`, so the image alone can pass the default 8 MiB read budget once it is about 5.56 MiB. Such a file fails a default read with `INPUT_TOO_LARGE`. A file with a browsed image reads with `maxBytes` of 16 MiB; a clipboard image has no upper bound, and the largest `maxBytes` the library accepts is 64 MiB. The default is a documented trade-off ([threat model](security/THREAT_MODEL.md#proposed-resource-budgets)) and raising it is a maintainer decision. The largest file in the maintainer's local corpus is 3,128,021 bytes. The demo says so when it refuses a file for its size.
- **Selective export.** None of Anamnesis (v7.57.0.3), Ktisis (v0.4.1.2) and Brio (v0.8.0.12) offers a selective export: every writer saves all sections, and the save modes or import options apply to import only. Selective exports are therefore not available to collect from the current builds; builds of Anamnesis before 2021-09-28 and the Ktisis v0.2 line had them and are not verified here.

### Refreshing the record: compare meaning, not only bytes

Byte-identical serializer files do not show that a stored value still means the same thing. A refresh therefore also reads the files listed in the two tables above (and the lip, face-paint and eye rows of the appearance semantics table) and checks, for each, that the field it defines is still read and written the way this document says, and records the result next to the commit it was checked at. A changed hash in any pinned file needs that reading before the pin is moved. See [AGENTS.md](../AGENTS.md#refresh-producer-compatibility-before-significant-changes).

## Field and presence matrix

Field names are case-sensitive, except the decoded `Base64Image` key is discarded case-insensitively at every depth. Known field normalization uses this matrix regardless of the declared producer.

| Group | Fields / shapes | Interpretation |
| --- | --- | --- |
| Metadata | `TypeName`, `$type`, `FileExtension`, `FileVersion`, `Author`, `Description`, `Version`, `Nickname`, `SaveMode`, `ObjectKind` | Stored strings; version/save/object-kind fields also accept unsigned 32-bit integers. No type instantiation, save-section filtering, or producer dispatch. Unknown save flag names remain stored evidence. |
| Identity | `Race`, `Tribe`, `Gender`, `Age`, `ModelType` | Known enum names or numeric IDs; `Lalafel`, `Miqote`, and `AuRa` have canonical race aliases. Legacy tribe `Helion` normalizes to `Helions` since beta.3; raw evidence is preserved. Supported Tribe determines canonical race; absent/null Tribe permits Race fallback, an unsupported/invalid Tribe does not. Declared Race remains independently visible. Age IDs 0/1/3/4 mean None/Normal/Old/Young. ModelType is uint32. |
| Byte customization | `Height`, `Head`, `Hair`, `Skintone`, `REyeColor`, `HairTone`, `Highlights`, `LimbalEyes`, `Eyebrows`, `LEyeColor`, `Eyes`, `Nose`, `Jaw`, `Mouth`, `LipsToneFurPattern`, `EarMuscleTailSize`, `TailEarsType`, `Bust`, `FacePaint`, `FacePaintColor` | Integers 0–255; inspection applies no palette interpretation or bit masking. Appearance reads bit `0x80` of `Mouth` as the lip-color enable and masks bit `0x80` of `FacePaint` as a mirror flag ([below](#appearance-semantics-reviewed-in-source-2026-10-23)). |
| Customization flags | `EnableHighlights`, `FacialFeatures` | Strict boolean; facial features accept a byte or known comma-separated enum names. |
| Extended colors | `SkinColor`, `SkinGloss`, `LeftEyeColor`, `RightEyeColor`, `LimbalRingColor`, `HairColor`, `HairGloss`, `HairHighlight`, `MouthColor` | Finite three-component vectors, four for mouth: comma-separated decimal strings, arrays, RGB(A) or XYZ(W) records. Stored source shape is retained. Components are not gamma converted, clamped, swapped, or declared active. Object/array shapes are admitted extensions; exact converter coverage remains a future compatibility gate. |
| Extended controls | `IsExtendedAppearanceValid`, `BustScale`, `Transparency`, `MuscleTone`, `HeightMultiplier` | Strict boolean, finite three-component vector, or finite number respectively. Missing validity flags stay absent. |
| Equipment | `MainHand`, `OffHand`, `HeadGear`, `Body`, `Hands`, `Legs`, `Feet`, `Ears`, `Neck`, `Wrists`, `LeftRing`, `RightRing` | Explicit slot records with `ModelBase`, `ModelVariant`, and weapon `ModelSet`. Lanes are uint16. Missing/null lanes are incomplete; they never default to zero. All-zero valid models are empty. Weapons with a positive set or base are worn. |
| Dyes | Per-slot `DyeId`, `DyeId2` | Independent uint16 evidence, including zero. Wider acceptance accommodates the Ktisis weapon shape; individual producers can impose narrower limits. A dye error does not discard a valid model. |
| Facewear | `Glasses: number` or `Glasses: { GlassesId: number }` | uint16; zero remains valid. Missing/invalid nested IDs never default to zero. |
| Unknown fields | Any other admitted JSON values | Preserved as recursively inert null-prototype records; unsupported top-level fields have bounded diagnostics. No configuration merging or executable content. |
| Images | `Base64Image` at any depth | Presence/type/path metadata only; payload omitted, without base64 decoding or image rendering. Non-string/non-null image fields are flagged and still structurally checked. |

Every inspected field has state `absent`, `null`, `valid`, `invalid`, or `unsupported`, optional raw evidence, and a value only when valid. Empty strings, false, and zero remain distinct. Equipment separately reports absent/null/invalid/empty/worn. Inspection retains the document by reference and does not mutate it; callers must treat shared evidence as untrusted read-only data.

Unknown fields are preserved without promising semantics for every historical/future producer, modded actor, producer-specific extra field, or alternate enum spelling. There is no claim that an admitted synthetic fixture was exported by the named application.

## Local corpus check

The maintainer supplied a private sample folder for read-only testing. On 2026-10-19, all 1,093 top-level `.chara` files were admitted and inspected: 1,837–3,128,021 bytes, 5,864,432 total bytes. There were no invalid/unsupported identity, customization, extended-color, or facewear values. The inspection reported 10,901 worn slots, 58 incomplete model records, and 99 unsupported-field diagnostics. Image-key presence was reported for 94 files; this count includes null/empty image fields, not only nonempty images.

These are aggregate compatibility observations, not independently reviewed expected values for each real character. No private samples, file names, producer metadata, images, or per-character results are committed. Reproduce locally with `pnpm exec tsx scripts/check-corpus.ts <sample-directory>`; the script prints aggregate counts only and performs no network I/O. Synthetic fixture hashes and hand-reviewed identity/facewear expectations use `pnpm verify-fixtures`.

## Pending compatibility gates

- Real producer-generated fixtures with explicit redistribution rights and independently reviewed complete expectations. See the [fixture validation checklist](producer-fixture-validation.md) for supported export modes and review requirements; purely equipment-only producer exports are not required.
- Broader independent visual/producer swatch expectations; real-source regeneration now matches the baseline exactly. See [appearance validation](security/appearance-validation.md) for implemented Tasks 3–4 and corpus observations.
- Additional browser engines/runtime versions beyond the [installed-package and demo matrix](security/distribution-validation.md). Chromium, module Web Worker, Node/Node Worker and local workerd now pass the pinned smoke cases; this does not establish exhaustive platform/version compatibility.

Release rights are no longer a pending gate: npm publishing is configured and the betas are published (see the [runbook](npm-publication-readiness.md)), and the maintainer elected to ship the bundled appearance palettes on 2026-10-21, as recorded in the [data review](data-redistribution-review.md#recorded-release-decision). Original code and original synthetic fixtures follow MIT, approved producer exports retain recorded permission, and dye names use optional API lookup. Separate game-derived rights notices remain applicable.

## Evercold color-picker follow-up

On 2026-10-21 the maintainer identified free color pickers for eyes, hair and skin as an anticipated Evercold change in 2027. This is a maintainer-supplied planning requirement, not verified support for a released game or producer format. It does not block the current beta or remove palette support for existing exports.

- Retain indexed appearance palettes for legacy documents and any future exports that still store palette indices.
- Review actual Anamnesis, Ktisis and Brio exports when available. Establish new field names, color encoding/ranges, presence and activation rules, and precedence when both indices and direct colors exist; do not assume the current extended-color fields are the new format.
- Add permissioned producer fixtures for eye, hair and skin free colors, including mixed legacy/new fields, and verify swatches against producer controls before claiming support.
- Keep stored values distinguishable from interpretation. Existing extended-color handling is useful infrastructure, but unknown future values must not be forced onto the nearest palette entry or given invented semantics.
