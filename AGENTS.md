# XIVCharaKit contributor guidance

## Refresh producer compatibility before significant changes

Before making significant changes to this library, especially parsing, inspection, appearance/equipment interpretation or compatibility claims:

- Check the latest available builds/releases of **Brio, Ktisis and Anamnesis** through their official release channels and corresponding `.chara` export/serialization sources. Do not assume the previously reviewed snapshots still describe their current formats.
- Compare their field names, types, enums, save modes, version markers and serialization behavior with the supported contracts in [docs/compatibility.md](docs/compatibility.md). Determine whether new `.chara` revisions or producer-specific differences require changes to the library; do not assume all three producers share one format revision.
- Record the date, build/release versions and source commits checked, along with compatibility findings, in the compatibility documentation. Update [fixtures/manifest.json](fixtures/manifest.json) when format references or fixtures change. Distinguish source review from testing actual producer exports and state any unverified behavior.
- Compare meaning as well as bytes: besides the serializer files, read the pinned files that define what a stored value means (the lists in [docs/compatibility.md](docs/compatibility.md#files-pinned-for-what-a-field-means-2026-10-24) and the appearance semantics table: lip-enable and face-paint bits, extended eye-color offsets, enum names, vector formats, which fields each writer emits). A hash that is unchanged settles nothing about a file that is not pinned, so add a pin, with the SHA-256 recomputed from the raw file at the pinned commit, for any file a new conclusion depends on.
- Where adoption is needed, update the affected reader, inspection/types, interpretation, documentation and regression coverage together. Use reviewed synthetic or explicitly approved producer fixtures, and preserve support for existing exports unless a compatibility change is deliberately documented.
