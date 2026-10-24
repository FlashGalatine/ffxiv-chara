# Open-source licensing review

Researched on 2026-10-20. The maintainer subsequently selected MIT for original code and requested Square Enix attribution/non-affiliation notices. MIT is now applied to original library, demo and tooling code; game-derived data and fixture permissions remain separately documented. This research does not establish legal clearance for every bundled asset.

## Verified producer licenses

| Project | Root license | Pinned current revision | License Git blob |
| --- | --- | --- | --- |
| Anamnesis | MIT | `3d635757758ea9bd4e6d6d515cd6724bfabaa299` | `6f6a2ff6e4fc1546f2e214369a41677b7b83b9ec` |
| Ktisis | GNU GPL version 3 | `551bb23f5726ecffd1426ee3b540caf34feab18a` | `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7` |
| Brio | GNU GPL version 3 | `f241205f774595dd01e6bb06ff318643414435f6` | `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7` |

Primary license files: [Anamnesis](https://github.com/imchillin/Anamnesis/blob/3d635757758ea9bd4e6d6d515cd6724bfabaa299/LICENSE), [Ktisis](https://github.com/ktisis-tools/Ktisis/blob/551bb23f5726ecffd1426ee3b540caf34feab18a/LICENSE), [Brio](https://github.com/Etheirys/Brio/blob/f241205f774595dd01e6bb06ff318643414435f6/LICENSE).

GitHub's license API returned NOASSERTION for Anamnesis, but manual inspection shows the MIT permission text and named copyright holders. Do not interpret automated classification as absence of a license. Ktisis and Brio have identical GPLv3 license-text blobs. The root license text alone is not used to infer an additional “or later” grant from its example application instructions; check the actual grant on any code being reused before choosing an exact SPDX expression for that upstream material.

The implementation's earlier format-reference revisions are Anamnesis `f97c9808185fd9af24d3dd9101e4e87466d65fc4`, Ktisis `551bb23f5726ecffd1426ee3b540caf34feab18a`, and Brio `5213bd81cf5bacee430548d4aff96500298dcc21`. Their root license files were also read: MIT, GPLv3 and GPLv3 respectively. Anamnesis's reviewed CharacterFile.cs explicitly carries an MIT header. The reviewed Ktisis and Brio format files do not provide a separate permissive file header; do not treat them as MIT merely because the format resembles Anamnesis.

## Compatibility for this project

MIT and GPLv3 are both open-source choices. Their different reuse conditions matter more than matching producer license names.

| Situation | Consequence for the decision |
| --- | --- |
| Independently implemented reader consuming producer files | Supporting those formats does not, by itself, require adopting the producer application's license. Keep provenance showing the difference between format facts and copied implementation. |
| Copying or adapting MIT code | Preserve the applicable copyright and permission notices. MIT permits distribution under other terms, subject to its notice requirement. |
| Copying or translating copyrightable GPLv3 implementation into a combined distributed program | Comply with the GPL for the covered combined work, including notices and corresponding-source obligations; it cannot be distributed solely under MIT without separate permission. A different programming language does not remove the issue. |
| A GPL application consumes an MIT library | MIT is GPL-compatible; the combined distributed work can comply with the GPL while retaining the MIT library's notices. Compatibility does not authorize relicensing third-party GPL code as MIT. |
| A user exports their own character using a GPL application | The tool's license does not automatically license its output. Review rights in the output itself, including any substantial embedded upstream material. |

These distinctions follow [GPLv3 sections 0, 2, 5 and 6](https://www.gnu.org/licenses/gpl-3.0.html), the [FSF's MIT/Expat compatibility guidance](https://www.gnu.org/licenses/license-list.html#Expat), and its [program-output FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#WhatCaseIsOutputGPL). The US Copyright Office also distinguishes ideas, processes and systems from protected expression under [17 USC 102(b)](https://www.copyright.gov/prereg/help.html). Whether particular reused material is protected expression or forms a derivative work remains fact-specific; this research is not a substitute for that review.

The repository's documented provenance describes original reader/inspection code informed by producer field contracts, with adapted palette/appearance/query conventions from MIT-licensed XIV Dye Tools. Current notices retain the XIV Dye Tools MIT notice. This supports considering a permissive license, but it is a provenance-based assessment, not a fresh line-by-line proof that no GPL-covered expression was reused. Before release, check any disputed or newly imported code against its exact source and license.

## Recommendation

**Use MIT for this project's original library and demo code**, provided that source-origin review continues to confirm the documented implementation boundary. It fits a reusable runtime-neutral library, aligns with XIV Dye Tools, and permits adoption by both permissive and GPL projects. Retain all applicable third-party notices.

Choose GPLv3 instead if the maintainer wants distributed derivative/combined software to preserve GPL source-sharing obligations, or if GPL-covered implementation is incorporated and no separate permission is obtained. For a browser demo, shipping compiled JavaScript is distribution of code; public hosting should not be assumed to avoid the corresponding-source obligations of a GPL choice. GPLv3 is not the AGPL's network-use licensing model.

This recommendation is about code. Neither MIT nor GPL grants Square Enix rights to generated palettes, dye names, artwork or other game-derived material. Original synthetic fixture contributions follow the maintainer-selected project MIT license. The approved player-character fixtures retain recorded contributor redistribution permission; this does not relicense underlying third-party material. The [beta redistribution review](data-redistribution-review.md) records the exact shipped data and the maintainer's 2026-10-21 decision to retain bundled appearance palettes with separate notices and provenance.

## Adoption and remaining release work

- [x] Add the full MIT license and copyright attribution at the repository root; update package license metadata and current status documents.
- [x] Include the full license and required project notices in the installed tarball and static demo; verify exact file contents and allowlists.
- [x] State the scope of code licensing separately from fixture permissions and game-derived data notices.
- [x] Check the demo's Vite browser preload helpers and retain the Vite 8.3.4 core MIT notice in distributed notices. This is not a claim that all build-time dependencies ship in the demo.
- [x] Verify publishing configuration for the selected `xivcharakit` name, security reporting and Cloudflare deployment separately. Name selection does not publish or reserve an npm package. Done separately: the npm betas are published ([runbook](npm-publication-readiness.md)), private security reporting is enabled ([SECURITY.md](../SECURITY.md)), and the demo deployment was verified on 2026-10-22 ([Cloudflare hosting](cloudflare-hosting.md#deployment-verified-on-2026-10-22)).

MIT adoption adds the root license, package metadata, the installed `dist/LICENSE`, complete license/notices files in the static demo, and visible Square Enix attribution/non-affiliation copy in the README and demo footer. The notice uses the official North America policy's `© SQUARE ENIX` wording, checked on 2026-10-20 against the [policy effective October 14, 2026](https://support.na.square-enix.com/rule.php?id=5382&policy=update&tag=authc). Neither attribution nor the MIT grant establishes permission for every game-derived dataset. No publication setting was changed.
