# Cloudflare demo hosting

The [live demo](https://charakit.projectgalatine.com) uses the `xivcharakit-demo` Workers Static Assets service configured in [apps/demo/wrangler.jsonc](../apps/demo/wrangler.jsonc). Deployment is manual; no automatic production deployment workflow is enabled.

## Architecture and public files

Cloudflare serves only `apps/demo/dist`, without application Worker code, database or storage bindings. The module Web Worker that inspects character files runs in the visitor's browser. Optional equipment, dye-name and icon requests go directly to XIVAPI after the visitor's explicit action, preserving the existing identifier-only privacy boundary.

`pnpm build` generates `_headers` from the same policy used by Vite preview. Complete `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` files are generated from canonical repository files. Public examples remain reviewed synthetic fixtures. The artifact allowlist excludes raw `human.cmp`, real producer test exports, source maps and repository files.

Cloudflare parses `_headers` as configuration and does not serve it. Missing files return 404 instead of an HTML fallback. The site has no client-side route hierarchy. The configuration disables `workers.dev` and version-preview URLs; the custom hostname is its public entry point.

The demo sends `Cache-Control: public, max-age=0, must-revalidate, no-transform` to preserve the reviewed page bytes. The first deployment revealed Cloudflare JavaScript Detections injecting an inline script that the existing CSP blocked. Cloudflare [honors `no-transform` by omitting that injection](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/#if-your-origin-sends-a-no-transform-header). This response policy is scoped to the demo. Hosting checks require the served HTML to match the built document exactly.

See Cloudflare's [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [headers](https://developers.cloudflare.com/workers/static-assets/headers/) and [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) documentation. Custom Domains require an active zone in the deploying account. Cloudflare manages the hostname's DNS record and certificate; review existing bindings and DNS records before replacing them.

## Local preview

Use the pinned Node 22.21.0 and pnpm 10.27.0. From the repository root:

```powershell
pnpm install --frozen-lockfile
$env:WRANGLER_SEND_METRICS = 'false'
pnpm build
pnpm preview:cloudflare
```

The local preview uses `http://127.0.0.1:4175` and does not deploy the domain. Stop it before running the automated suite, which owns the same port:

```sh
pnpm test:demo:cloudflare
```

This runs the existing browser regressions against Cloudflare asset serving, plus HTTP checks for security headers, JavaScript MIME types, legal files and missing/private paths. CI is configured to run the suite on Ubuntu and Windows. Default tests use controlled upstream responses; live XIVAPI checks remain opt-in.

## Manual deployment

Review the checkout and diff. Confirm the intended account with `pnpm exec wrangler whoami` and that `projectgalatine.com` is active in that account. Existing Wrangler OAuth authentication works locally. If multiple accounts are available, set `CLOUDFLARE_ACCOUNT_ID` explicitly. Never commit credentials.

Run the normal checks:

```sh
pnpm type-check
pnpm lint
pnpm test
pnpm verify-fixtures
pnpm verify-palettes
```

For a deployment dry run, run `pnpm test:demo:cloudflare` and `pnpm test:package`, then:

```sh
pnpm exec wrangler deploy --config apps/demo/wrangler.jsonc --autoconfig=false --dry-run --outdir .superpowers/cloudflare-demo-dry-run
```

After reviewing and authorizing the release:

```sh
pnpm deploy:demo
```

This command runs Cloudflare browser/HTTP checks, rebuilds and validates the final public artifacts through `test:package`, then deploys the configured service and hostname. Autoconfiguration is disabled so deployment uses the reviewed configuration. It does not publish or bump the npm library.

## Deployed-origin acceptance

Verify HTTPS, actual response headers, module-worker loading, lazy palettes, synthetic examples, file selection and legal links on the custom hostname. Verify missing assets return 404. Local tests do not establish deployed-origin behavior.

The hosting checks can target the deployed origin without starting a local server:

```powershell
$env:DEMO_BASE_URL = 'https://charakit.projectgalatine.com'
pnpm --filter @xivcharakit/demo exec playwright test --config playwright.cloudflare.config.ts hosting/hosting.spec.ts
```

The spec compares the served `index.html` with the local `apps/demo/dist/index.html` and takes the hashed worker file name from the local `apps/demo/dist/assets/`. Check out the commit that is deployed and run `pnpm build` first: a local build from a different commit fails with an `index.html` body mismatch or a 404 for the worker asset.

For an ordinary, low-volume live XIVAPI check using only the public synthetic example:

```powershell
$env:CHARA_LIVE_SMOKE = '1'
pnpm --filter @xivcharakit/demo exec playwright test --config playwright.cloudflare.config.ts e2e/live.spec.ts
Remove-Item Env:CHARA_LIVE_SMOKE
Remove-Item Env:DEMO_BASE_URL
```

Optionally set `DEMO_QA_DIR` to an existing ignored directory to save the live request audit and screenshot. Use synthetic examples for public acceptance evidence. Recheck deployed-origin CORS when hosting or upstream settings change.

## Deployment verified on 2026-10-22

The initial deployment created the custom-domain binding and its managed certificate in the existing active `projectgalatine.com` zone. The verified final Cloudflare version is `9d560c34-7991-4571-bfb3-3c34f2bdccff`.

That deployment used the beta.2 library implementation before the `Helion` fix. Its artifact and acceptance results below are a historical record; beta.3, published to npm on 2026-10-22, needs a separate authorized deployment and deployed-origin acceptance check.

All 19 publicly served files (304,064 bytes) matched the reviewed local build exactly by byte length and SHA-256. The generated `_headers` configuration remained inaccessible. Deployed-origin checks passed for HTTPS, security headers, JavaScript MIME types, complete legal files and missing/private paths. The opt-in Chromium check passed local inspection, explicit equipment/facewear lookup and two decoded icons using the public synthetic Ktisis example. Its five XIVAPI requests were GETs with no body, credentials or referrer, and all returned HTTP 200 with CORS enabled. The example's dye IDs are zero, so that live check did not exercise nonzero Stain-name resolution.

Local validation passed 26 Cloudflare browser/hosting checks (one opt-in live case skipped), the regular tooling/library/browser suites, type checks, lint, fixture/palette verification, dependency audit and installed-package runtime checks. The Cloudflare suite is configured in CI; these are local and deployed-origin results, not a claim that the pending CI changes have run on GitHub. Ignored evidence is retained under `.superpowers/cloudflare-demo-20261022`.
