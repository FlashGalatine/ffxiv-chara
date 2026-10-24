# npm publication runbook

Prepared on 2026-10-20. The maintainer selected **xivcharakit@0.1.0-beta.1** on **next**. Preparation does not publish or reserve the npm name. At the maintainer's subsequent step-2 request, GitHub private vulnerability reporting was enabled and verified; publication and other account/protection changes remain separate actions.

**Recorded status — 2026-10-22:** beta.2 was published through [GitHub Actions run 39716330737, attempt 2](https://github.com/FlashGalatine/XIVCharaKit/actions/runs/39716330737/attempts/2) from `8f30f7b4a20b857a5efa1aa1dc4c0b0d9ed1b48b`. Its registry tarball matched the reviewed 85,477-byte, 42-file candidate; integrity, registry signatures, signed provenance and isolated installation were verified. The recorded tags were **next → beta.2** and **latest → beta.1**. The existing trusted publisher successfully authenticated that release. Recheck live registry/protection state for each future publication; the bootstrap notes below are history, not a reason to republish beta.1 or beta.2.

**Recorded status — 2026-10-23:** beta.3 was published on 2026-10-22 (registry time 12:55 UTC) by [GitHub Actions run 39781354413](https://github.com/FlashGalatine/XIVCharaKit/actions/runs/39781354413), whose `publish` job succeeded, from `39b849fb585eb2bb7d31ce139593fab5afaeb530`; an earlier [dry run](https://github.com/FlashGalatine/XIVCharaKit/actions/runs/39781015592) skipped publication. The registry lists a 42-file tarball with registry signatures and SLSA provenance. On 2026-10-23 the attestation subject digest was compared with the registry integrity (equal) and names run 39781354413, `publish.yml` and `main`; the signatures and an isolated install were not re-checked. The tags are **next → beta.3** and **latest → beta.1**.

## Beta.4 procedure (prepared; not published)

The working candidate is **xivcharakit@0.1.0-beta.4**, with committed `publishConfig.tag` and the workflow tag default remaining **next**. It carries every change listed under 0.1.0-beta.4 in the changelog: appearance policy `1.1.0` (the lip-color bit, the `FacePaint` mirror bit, the `EYE_PAIRING_UNCONFIRMED` warning), the XIVAPI client fixes (a missing Stain or Glasses row, option reads, the `Retry-After` grammar, cache and signal handling), cross-realm input and the inspection codes. Two public types change: `AppearancePolicy.version` is typed `'1.1.0'` and `AppearanceReason` gains `lipDisabled`. Palette data and runtime dependencies are unchanged. CI and the publish workflow both run `pnpm audit`; three `undici` advisories reached through `wrangler` and `miniflare` (a development dependency) are cleared by an exact override of `miniflare>undici` to the patched 7.30.1 in `pnpm-workspace.yaml`, because wrangler 4.152.0 still ships 7.29.1. Drop the override when wrangler ships a patched miniflare. Preparing or merging its PR does not publish beta.4 or redeploy the demo.

1. Review and merge the beta.4 preparation PR, then require successful Ubuntu and Windows CI on the resulting `main` commit.
2. Reconfirm the npm trusted publisher matches `FlashGalatine/XIVCharaKit`, `publish.yml`, environment `npm-release`, and permits direct publication; check the current connection and protections. A dry run does not itself validate OIDC or the environment approval gate; do not recreate or expand access automatically.
3. Open Actions → **Publish to npm** → Run workflow. Select **main**, expected version **0.1.0-beta.4**, tag **next**, and **dry_run: true**. The exact version must still be unused on npm; registry errors fail closed.
4. Inspect the successful run and its downloaded `npm-candidate`: compare the tarball SHA-512 with `release.json` and the independent prepare-step log, then check package name/version, README, exports and full legal files. No earlier beta's artifact can substitute for beta.4.
5. Dispatch the same reviewed `main` commit/version/tag with **dry_run: false**. If `main` advances between runs, repeat the dry run for the new commit. The real run repeats verification; inspect that run's artifact before approving the protected **npm-release** environment.
6. After publication, verify registry integrity against that run's manifest, install the exact released version and cryptographically check registry signatures/provenance. Verify the attestation subject digest and source commit/workflow/run. Expect **next → beta.4** and **latest → beta.1**; no separate tag change is part of this beta release.

## Beta.3 procedure (used for the 2026-10-22 publication)

The candidate was **xivcharakit@0.1.0-beta.3**, with committed `publishConfig.tag` and the workflow tag default remaining **next**. Beta.3 adds legacy `Helion` → `Helions` normalization, preserving stored evidence and numeric tribe IDs, with refreshed producer source references and regression coverage. The PR also includes demo hosting configuration, hosted acceptance records and the separate XIV Dye Tools integration plan. Public API signatures, palette data and runtime dependencies are unchanged. Preparing or merging this PR does not publish beta.3 or redeploy the demo.

1. Review and merge the beta.3 preparation PR, then require successful Ubuntu and Windows CI on the resulting `main` commit.
2. Reconfirm the npm trusted publisher matches `FlashGalatine/XIVCharaKit`, `publish.yml`, environment `npm-release`, and permits direct publication. Beta.2 verified the protected OIDC path, but check the current connection and protections for beta.3. A dry run does not itself validate OIDC or the environment approval gate; do not recreate or expand access automatically.
3. Open Actions → **Publish to npm** → Run workflow. Select **main**, expected version **0.1.0-beta.3**, tag **next**, and **dry_run: true**. The exact version must still be unused on npm; registry errors fail closed.
4. Inspect the successful run and its downloaded `npm-candidate`: compare the tarball SHA-512 with `release.json` and the independent prepare-step log, then check package name/version, README, exports and full legal files. Neither earlier beta's artifact can substitute for beta.3.
5. Dispatch the same reviewed `main` commit/version/tag with **dry_run: false**. If `main` advances between runs, repeat the dry run for the new commit. The real run repeats verification; inspect that run's artifact before approving the protected **npm-release** environment.
6. After publication, verify registry integrity against that run's manifest, install the exact released version and cryptographically check registry signatures/provenance. Verify the attestation subject digest and source commit/workflow/run. Expect **next → beta.3** and **latest → beta.1**; no separate tag change is part of this beta release.

## Candidate and verification

Only `packages/chara` is publishable; root and demo stay private. The library has five ESM exports, declarations, zero runtime dependencies, a package-root README and full MIT/third-party legal files. `pnpm test:package` derives the tarball name from committed metadata, scans package/demo outputs and exercises installed consumers across five runtimes. It does not publish.

The manual-only [publish workflow](../.github/workflows/publish.yml) accepts expected version, tag and dry-run inputs. It requires `FlashGalatine/XIVCharaKit`, `refs/heads/main`, a matching committed version/tag and an unused registry version. Prereleases cannot target latest. Dry-run defaults to true and never enters the OIDC publication job. No push, merge or tag automatically publishes.

The verification job runs builds, types, lint, fixture/palette checks and dye-lookup tests, tooling/library/browser tests, audit and the final installed-package gate. It records the checked tarball's SHA-512 integrity, commit and package identity in `release.json`, then retains only that candidate and manifest for seven days. Publication downloads that run's artifact ID, compares both manifest and bytes with the separate verification-job integrity output and rechecks registry availability. It publishes the same tarball with lifecycle scripts disabled, without rebuilding or installing repository dependencies in the privileged job. Registry errors fail closed; only an exact-version 404 passes.

Build tooling stays pinned to Node 22.21.0 and pnpm 10.27.0. The publication job installs npm 11.21.0, compatible with that Node version and OIDC. Ordinary CI retains read-only permissions; only the manual publication job has `id-token: write` and declares the `npm-release` environment. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Before the first public release

1. Preparation and the subsequent notice/cached-dye changes were reviewed and merged through [PR 3](https://github.com/FlashGalatine/XIVCharaKit/pull/3) and [PR 4](https://github.com/FlashGalatine/XIVCharaKit/pull/4). Post-merge Ubuntu/Windows CI and the fresh hosted dry run passed for `90abb4721b35b3c8d564e8c1a6855fd8c9de0e8a`. MIT applies to original code and original synthetic fixture contributions; preserve the separate [notices](../THIRD_PARTY_NOTICES.md) and [provenance](data-provenance.md).
2. Confidential reporting is enabled and verified through [GitHub private vulnerability reporting](https://github.com/FlashGalatine/XIVCharaKit/security/advisories/new), as documented in [SECURITY.md](../SECURITY.md). The [data redistribution review](data-redistribution-review.md) records the maintainer's 2026-10-21 decision to ship the bundled appearance palettes with existing notices and provenance. The raw `human.cmp` remains excluded, and dye names use optional cached XIVAPI lookup. The retain/remove decision is closed; the decision does not grant third-party rights or change the MIT code-license boundary.
3. GitHub protections were configured and read back on 2026-10-21; see the exact [configuration below](#github-protections-configured-2026-10-21). `main` requires PRs, both GitHub Actions CI jobs, an up-to-date branch and resolved conversations, including for administrators. The **npm-release** environment permits only the `main` branch and requires **FlashGalatine** approval with administrator bypass disabled. After bootstrap and trusted-publisher verification, **NPM_RELEASE_ENABLED** was set to `true`; the variable does not itself configure protection.
4. Historical beta.1 dry-run evidence: the [fresh dry run](https://github.com/FlashGalatine/XIVCharaKit/actions/runs/39541256961) passed for `90abb4721b35b3c8d564e8c1a6855fd8c9de0e8a`, with publication skipped; the downloaded 42-file candidate, source metadata, README/legal bytes and independent prepare-log SHA-512 were verified. This superseded the [initial candidate](https://github.com/FlashGalatine/XIVCharaKit/actions/runs/39488195133). Beta.1, beta.2 and beta.3 are now published and cannot pass the unused-version preflight again. For the next candidate, follow the most recent procedure above with the new version.
5. Reconfirm the authenticated npm owner and 2FA locally. The previous live `npm whoami` returned **flashgalatine**; 2FA completion was maintainer-reported. Do not put passwords, recovery codes or tokens in chat or the repository. Registry name availability must be rechecked at publication; a 404 is not a reservation.

## GitHub protections configured 2026-10-21

- `main` has classic branch protection requiring `Verify (ubuntu-24.04)` and `Verify (windows-2025)`, each pinned to GitHub Actions app ID `15368`, with strict/up-to-date checks.
- Pull requests and resolved review conversations are required. Administrator enforcement is enabled; force pushes and branch deletion are disabled. Merge commits remain allowed, matching the existing workflow.
- The required approving-review count is zero for this solo-maintainer repository. PRs and CI remain mandatory; a second person's approval is not enforced. Continue the independent review process before merging.
- The `npm-release` environment has a single allowed deployment policy: branch `main`, with no tags allowed. Its required reviewer is **FlashGalatine**. Self-approval is permitted so the sole maintainer can approve a manually initiated release; this is a manual gate, not two-person authorization.
- Environment administrator bypass is disabled. The API creates the reviewer and branch policies; the GitHub settings UI was used to disable bypass, then all settings were read back through the API. Future API reconfiguration must also verify the bypass value rather than assume its default is safe.
- At initial protection setup, `NPM_RELEASE_ENABLED` was absent. After beta.1 bootstrap and trusted-publisher verification, it was set to `true`. No credentials or environment secrets were added. Beta.2 later exercised the real protected publication and OIDC path successfully. An ordinary dry run still skips the publication job and does not itself exercise manual approval or OIDC trust.

## One-time bootstrap

npm requires the package to exist before its trusted publisher can be configured. The first release therefore needs an explicitly authorized interactive publication of the reviewed tarball, using the logged-in owner and npm's 2FA prompt. Once the preceding gates and artifact review are complete, the command is:

```sh
npm publish <absolute-path-to-reviewed-xivcharakit-0.1.0-beta.1.tgz> --ignore-scripts --registry=https://registry.npmjs.org --access public --tag next
```

This is a real public registry write, not a dry run; do not execute it as part of preparation. Publish the downloaded, checked artifact rather than the workspace or an unverified rebuild. Local bootstrap does not claim GitHub Actions provenance. Verify published `dist.integrity` against the reviewed manifest, inspect `dist-tags`, and install the exact version in a fresh consumer. [Public package publishing](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/), [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

The bootstrap consumed beta.1, the first CI release consumed beta.2 and the second consumed beta.3. Do not attempt to publish any of them again: npm versions are immutable. For the next beta, bump the version, merge its reviewed preparation, require green main CI, inspect a fresh dry run and confirm that the trusted publisher remains valid before dispatching publication.

## Trusted publisher and continuing manual releases

On the existing package's npm settings, add the GitHub Actions trusted publisher with these exact values:

| Setting | Value |
| --- | --- |
| Owner | FlashGalatine |
| Repository | XIVCharaKit |
| Workflow filename | publish.yml |
| Environment | npm-release |
| Allowed actions | Enable direct **npm publish**; separate dist-tag management is unnecessary |

On 2026-10-21, authenticated `npm trust list xivcharakit` using npm 11.21.0 confirmed an existing matching connection, ID `0f3ef803-6625-4812-ab46-7502bdb20037`, with `publish` and `stage publish` permissions and no separate dist-tag permission. No duplicate connection was created. GitHub's release-enable variable was then set and read back as `true`. Branch/environment protections remained intact, including the main-only deployment policy and disabled administrator bypass. The global npm 11.7.0 installation was unchanged; the newer CLI was invoked through a pinned `npm exec` package.

Explicitly enable direct publishing when creating this publisher. New configurations default to stage-only permission, which cannot authorize this workflow's `npm publish`. Staging permission may remain enabled, but this workflow does not use it; leave separate `npm dist-tag` permission disabled. [Allowed actions](https://docs.npmjs.com/trusted-publishers/#for-github-actions).

npm requires a newly configured publisher's first successful publication within two days. Beta.2 successfully used this publisher on 2026-10-22 and satisfied its initial-publication validation; beta.3 used it again the same day. Recheck the matching repository/workflow/environment and current permission before each publication; do not recreate or expand trust automatically. Trusted CI publication uses OIDC, not the developer's local login or a stored npm write token. [Trusted publisher setup](https://docs.npmjs.com/trusted-publishers/).

The repository Actions variable `NPM_RELEASE_ENABLED=true` was verified for beta.2. To release each new version, recheck that gate and protection, merge its reviewed version/tag change, run the workflow dry run, inspect its artifact, then manually dispatch the same main commit/version/tag with dry-run unchecked. Approve the protected environment. The real dispatch repeats verification; inspect that run's artifact before approval. Publish future betas using `next`; retain **latest → beta.1** until a deliberate promotion is authorized. After publication, compare registry integrity and dist-tags, install the exact released package, and cryptographically verify its registry signatures and provenance. Then update the version statements that go stale at every publication: the supported versions in `SECURITY.md`, the status in `README.md` and `CONTRIBUTING.md`, `docs/data-provenance.md`, the `CHANGELOG.md` release heading and this runbook's recorded status.

No automation reserves versions, bumps metadata, moves tags, creates releases or merges PRs. Failed or concurrent publication is not retried by changing a version behind the workflow; review a new committed version instead. Disable releases by removing or setting the enable variable to false.

npm staged publishing is optional and is not used by this workflow. For a new name it creates a public placeholder, so it is not a substitute for a local dry run. [Staged publishing](https://docs.npmjs.com/staged-publishing/).
