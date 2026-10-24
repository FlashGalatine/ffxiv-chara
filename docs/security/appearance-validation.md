# Palette and appearance validation

Recorded 2026-10-19 on Windows x64, Node v22.21.0, pnpm 10.27.0. This supplements the threat model and [reader validation](reader-validation.md); it is not a security certification or a claim of game-rendering parity.

## Data and portability

All twelve public generated source files were downloaded by pinned commit and verified against their Git blob IDs; their SHA-256 values are retained in palette metadata. Creator source entries were checked for index order and RGB/hex agreement. Four generated artifacts contain 26,208 hex colors. `pnpm verify-palettes` independently recomputes logical JSON hashes/counts, validates complete table shapes through the provider, and checks known creator/shader colors. Game revision 7.57 is recorded from the maintainer's confirmation of the matching source binary.

The maintainer generator accepts an explicit local source path, checks a 182,272-byte minimum/16 MiB maximum and four-byte alignment before allocation, and reads only the admitted size. Tests use synthetic binary data to prove shared offsets, tribe/gender placement, creator/shader separation, and shader-hair color/sheen stride. On 2026-10-19 the maintainer supplied a 186,752-byte real `human.cmp` and confirmed its game version as 7.57. Check-mode hashes and subsequent write-mode regeneration matched all four committed tables exactly, covering 26,208 colors. The source stayed unchanged and outside the repository; its hash/size are recorded in `generatedFrom`. See [source verification](../data-provenance.md#supplied-source-verification--2026-10-19). No game installation was searched. The patch attribution is maintainer-provided; unused binary regions remain unverified.

Installed JS, ambient-type-free TypeScript, and Node Worker consumers import all three entry points and execute bundled palette/appearance work with fetch throwing on use. A 28-file tarball allowlist excludes source maps, raw JSON/game files, local source paths, research files, and private examples. MIT attribution and separate game-data notices are included. The main build's complete static dependency graph rejects optional code/data; palettes are emitted as lazy ESM chunks. Browser/Web Worker/workerd checks remain pending with Tasks 7–8.

## Behavior and test evidence

The final suite contains 205 tests, including 21 initial provider and five generator cases observed failing against placeholders, plus 49 initial appearance/math failures before implementation. Later opacity tests also failed before their implementation. Provider cases exercise invalid/prototype-shaped coordinates, lazy loading, concurrent-load coalescing, retry, fixed errors, immutable metadata, and detached colors. Appearance tests cover inactive/missing flags, exact zeros and ambiguous legacy blocks, missing context, toned ranges/gaps, Hrothgar fur indices, clipping, opacity, linear-light lip composites, provider failures/hostile color strings, eye-pair correction and both sides of the 6/1 thresholds.

Independent review found two Important provider issues and no Critical/Minor findings: non-string palette keys could coerce, and mutable caller requests could change association after an awaited load. Failing regressions reproduced both. Primitive-string admission and captured scalar coordinates now reject those malformed requests and preserve the original association when one object is reused concurrently. All 205 tests, strict types, lint, palette/fixture verification, build and installed-package checks pass after the fixes. No deferred code findings remain.

CIEDE2000 is checked against five published reference pairs, including symmetric evaluation, from [Sharma/Wu/Dalal's reference materials](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/). The cutoff examples use neutral-axis distances independently reduced to the lightness term: `#808080` to `#919191` is about 6.06269; to `#828282` about 0.75298; to `#838383` about 1.12538. The expected source-data fixtures are synthetic and contain no private character evidence.

## Private corpus observation

The opt-in local checker with `--appearance` processed all 1,093 supplied files without a fatal reader/inspection/appearance failure. Across 8,744 slots, the result was 8,033 palette, 706 inactive, three off-grid, and two unresolved with explicit out-of-range diagnostics. Twenty-two complete all-zero legacy blocks were reported as ambiguous, and three eye-pair corrections were applied (all on post-7.5 Brio files). These are aggregate policy observations, not independent visual approval of every swatch. No private samples, names, raw values, images, or per-character outputs are committed.

The two unresolved slots remain unresolved; the implementation does not clamp their palette indices or declare complete compatibility. Real producer exports with redistribution rights and broader independent expected values are still pending.

## Pending gates

Release identity/licensing, data-rights review, browser rendering under production CSP, complete browser/Worker/workerd package checks, network/cache budgets, explicit equipment lookup privacy, CI/release protections, and the reporting channel remain future gates. No package publication, website deployment, or existing-consumer migration was performed.
