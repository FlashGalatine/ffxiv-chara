# Real producer fixture validation

Status: four maintainer-supplied default exports have redistribution permission and stored-value regression checks. Partial exports are not available from the current Anamnesis, Ktisis and Brio (below); exact producer versions and independent producer-control expectations remain pending. Demo examples remain synthetic; private corpus admission does not close this gate.

## Required evidence

Collect default exports from each producer and selective exports only where the application supports those settings. A selective export can still include identity and other character-specific fields; a purely equipment-only file is not required. The maintainer clarified this limitation on 2026-10-20. Record the actual application version or commit, export settings, game version if known, and confirmation that the file was exported by that application. A stored producer label alone is not provenance.

| Producer | Full export | Partial export | Reviewed expectations | Redistribution permission |
| --- | --- | --- | --- | --- |
| Anamnesis | Two default exports retained as fixtures | Not available in the current producer (v7.57.0.3, `3d63575`): every writer saves all sections and the save modes apply to import only. Builds before 2021-09-28 had a selective save and are not verified | Stored-value tests passed; producer-control review pending | Granted by maintainer |
| Ktisis | Default export retained as fixture | Not available in current Ktisis (v0.3 and later, v0.4.1.2, `551bb23`): `Save()` always writes every section and the save modes apply to import only. The v0.2 line is not verified | Stored-value tests passed; producer-control review pending | Granted by maintainer |
| Brio | Default export retained as fixture | Not available in the current producer (v0.8.0.12, `3f6f8e1`): `ExportAppearance` writes the whole file and the import options apply to import only | Stored-value tests passed; producer-control review pending | Granted by maintainer |

Use deliberately created test characters with invented metadata and no embedded image where the producer supports that option. Keep original exports unchanged for provenance. If sanitization is necessary, record the exact transformation and hashes of both versions privately, then review the sanitized copy separately. Do not describe an edited fixture as an untouched producer export.

Existing private samples may be inspected locally under the supplied testing authorization. They must not be copied to public fixtures or uploaded without explicit selection and redistribution permission. Permission to test is separate from permission to redistribute. Record the contributor's rights statement and intended fixture license before committing any export; the project's original code is MIT-licensed, separately from fixture permissions.

## Independent expectations

Record expected values from producer controls/export settings and a manual review of the exported fields before comparing library output. Do not generate the expected values by calling the implementation under test.

- Identity: stored race/tribe/gender/age/model type and canonical identity, including absent and null fields.
- Customization: each present byte/flag, with absent/null/invalid evidence retained; no assumed defaults for selective exports.
- Extended appearance: original vectors/scalars and validity flags, active/inactive/ambiguous interpretation, indexed and extended swatch sources, and any expected correction. Distinguish computed previews from independently checked producer appearance.
- Equipment: all twelve slot states, each model lane, packed model key, both independent dye channels and facewear shape/ID. Empty, missing and malformed records remain distinct.
- Metadata, unknown fields and images: preserved evidence, omitted image payload and expected diagnostics. No equipment service or private corpus upload is required.

Where selective export settings exist, use them to establish actual producer omission/null/default behavior, allowing any accompanying character fields. Otherwise record that coverage as unsupported or unverified; do not require a fabricated equipment-only producer export. Synthetic partial fixtures continue to verify the library's selective-document contract. Include dual dye channels, supported facewear representations and extended-color validity cases where the producer supports them.

## Acceptance and integration

1. Verify provenance, permission and file hashes; review every proposed public byte for unintended private content.
2. Review the independent expectations and map them to the documented field contract in [compatibility](compatibility.md).
3. Add only approved fixtures and explicit expectations to the fixture manifest and verification/tests. Keep private originals and unapproved evidence outside tracked/public outputs.
4. Run fixture verification, focused inspection/appearance tests and the normal package/demo artifact gates. A mismatch needs investigation; neither fixture nor expectation should be changed merely to match current output.
5. Record producer versions, supported export modes, limitations and review evidence. Close supported producer coverage when reviewed expectations and redistribution clearance are recorded; document unavailable selective modes separately. There is no fixed six-file requirement.

## Current local evidence

On 2026-10-20, the existing read-only checker was rerun with appearance interpretation: 1,093/1,093 files accepted, zero invalid/unsupported inspected identity/customization/extended-color/facewear fields, 58 incomplete model records, and two unresolved out-of-range palette values. No sample names, metadata, images or per-character values were copied into the repository. This confirms aggregate compatibility against the same corpus; it does not establish producer versions, independent ground truth or redistribution rights.

### Maintainer-supplied default exports — 2026-10-20

The maintainer supplied four local files, describing them as default-setting exports from the latest Anamnesis, Ktisis and Brio versions. Exact installed application versions remain unconfirmed; stored file/schema versions are not assumed to be application versions. The maintainer subsequently confirmed that the character is their own player character and allowed redistribution. Four byte-identical copies are retained in [producer fixtures](../fixtures/producer-exports/README.md), with SHA-256 values, permission and provenance in the manifest. The source originals remain unchanged outside the repository. These files are test-only and do not replace synthetic demo examples.

All four passed reading, inspection and appearance resolution. An ignored local probe performed 629 comparisons against separately decoded JSON: retained top-level fields, equipment lane/dye presence and values, independent BigInt model packing, numeric/boolean customization, stored extended components and facewear IDs. Native fetch was disabled. All comparisons passed; appearance reported no issues. These checks establish consistency with stored fields, not independent visual/producer-control ground truth or exhaustive identity semantics.

The two Anamnesis exports have identical character fields and differ only in Author, Description and Version metadata, so they do not provide distinct full/partial coverage. Brio's extended eye colors are stored crossed relative to its eye indices, so its export is the only one that reports the `HISTORICAL_EYE_PAIR_SWAP` correction (checked on 2026-10-23 with per-eye display colors derived from the stored indices and the shipped creator table). All four exports store `Mouth` 2, so the lip-color bit is clear and the lip swatch is inactive. Brio's Tags field is preserved with an unsupported-field diagnostic; its null image marker is omitted with an image-omission diagnostic. Neither is a parse failure. Four retained regression tests (plus two added 2026-10-23: the lip-color bit, and an authored edit of the Brio export with one custom eye color) check reviewed stored identity/customization/model/dye/facewear values, validity presence, diagnostic behavior and appearance completion. Exact application versions and producer-control expectations remain pending; none of the three current producers can export selectively (table above).

Validation after integration: 324 library tests, 14 tooling tests and 20 browser scenarios passed (one intentional live skip); fixture verification checks nine character files and the unchanged three synthetic public examples. Type checks, lint and the installed-package gate passed. The tarball still contains 39 allowlisted files with no runtime dependencies; all five installed-runtime probes pass with zero native API requests. The static-demo and package artifact checks exclude these real exports. Source and destination hashes matched for every copied fixture.
