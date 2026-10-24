# Security policy

The published npm prereleases are `0.1.0-beta.1` (dist-tag `latest`), `0.1.0-beta.2` and `0.1.0-beta.3` (dist-tag `next`). No stable release is supported yet. The [threat model](docs/security/THREAT_MODEL.md) and [validation evidence](docs/implementation-progress.md) describe implemented controls, tested environments and remaining limits; they are not a security certification.

## Reporting

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/FlashGalatine/XIVCharaKit/security/advisories/new). Sign in to GitHub, or open the repository's [security advisories page](https://github.com/FlashGalatine/XIVCharaKit/security/advisories) and select **Report a vulnerability**. This is the project's confidential reporting route; do not disclose vulnerabilities in public issues or pull requests.

Private reporting was enabled and read back as enabled on 2026-10-20. The public advisories page was also checked for its reporting button. No test report was submitted. Confidentiality depends on GitHub's advisory access controls and the participants in the report.

Include the affected commit or package version, runtime, impact and minimal reproduction steps. Prefer a small synthetic character document; remove real player metadata, embedded images, credentials and other unrelated private information. Do not send an entire private sample collection. Do not probe XIVAPI or another third-party service to demonstrate a library issue.

## Versions and response expectations

Reports are accepted for current `main` and every published `0.1.0-beta.*` package: `latest` still installs beta.1, and `next` installs beta.3. No stable npm release is supported yet. Include the exact package version or main revision; published package versions are immutable, while development code can change. Older development snapshots should first be checked against current `main`.

This is a community-maintained project with best-effort triage; there is no guaranteed response or remediation deadline. Maintainers will use the private advisory discussion to assess impact, request reproduction details and coordinate a fix and disclosure. Maintainers should ensure their GitHub notification preferences include this repository's security alerts; enabling the repository setting does not configure personal notifications.

## Release boundaries

The CI workflow uses read-only repository permissions, committed fixtures (synthetic files and permissioned producer exports) and mocked APIs, and retains only the checked tarball and static demo artifacts. Publication and deployment need separate authorization, resolved code/data rights and verified production-host headers. A local workerd or preview check does not certify an eventual server host, browser origin or deployed configuration.

The separate manual npm workflow defaults to verification only. Real publication additionally requires main, matching committed version/tag, `NPM_RELEASE_ENABLED=true`, the `npm-release` environment and npm trusted publishing. Only its publication job has OIDC permission; it checks the downloaded tarball against the verification job's SHA-512 integrity and publishes those bytes without package lifecycle scripts. Configure environment/branch protection and resolve reporting/data rights before enabling releases; the variable alone does not establish those protections. See the [publication runbook](docs/npm-publication-readiness.md).
