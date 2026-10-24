# XIV Dye Tools consumer migration

The standalone package and reference demo are implemented here. Migrating XIV Dye Tools applications remains a separately authorized follow-up; no existing application is changed by this repository's implementation.

The [XIV Dye Tools integration implementation plan](docs/superpowers/plans/2026-10-22-xivdyetools-integration.md) is a draft grounded in the target's sources reviewed on 2026-10-22. It covers a shared core adapter, host-backed palettes, browser worker/session integration, bot consumers, compatibility gates and release validation. API-worker transport replacement and broader XIVAPI offloading remain separate follow-ups.

## Recommended integration boundary

Use XIVCharaKit for bounded reading, typed inspection and appearance interpretation. Keep existing creator/shader data behind a host `PaletteProvider`, retain offline dye names and nearest-dye matching, and preserve the enriched API-worker equipment boundary. Add new core facade exports and an explicit application projection while keeping old published parser/resolver contracts available. The web and bot migrations consume the shared facade; UI/session/telemetry and output privacy remain host responsibilities.

The library's richer partial-file and unresolved-state behavior is not a drop-in replacement for the old host model. The plan records intentional differences, including inactive lip alpha and missing shader evidence, and gates existing producer aliases before consumer adoption. Future eye/hair/skin free colors require actual game/producer format evidence rather than assuming current extended fields will represent them.

The legacy `Helion` → `Helions` compatibility fix is implemented and regression-tested in `0.1.0-beta.3`, published on 2026-10-22. Beta.2 lacks it; consumer adoption still requires verifying the published beta.3 artifact. The integration plan retains this release gate.

## Try a local artifact

`xivcharakit@0.1.0-beta.2` is published; its registry integrity and trusted-publisher provenance were verified on 2026-10-22. The integration target is exactly `xivcharakit@0.1.0-beta.3` (published 2026-10-22) once its registry artifact and provenance are verified, including the alias fix. Do not install a moving dist-tag for a reproducible migration. XIV Dye Tools' existing 24-hour release-age policy still applies. Beta.4 (prepared, not published) moves the appearance policy to `1.1.0`: it reads the lip-color bit of `Mouth` and the mirror bit of `FacePaint`, so on the committed real exports it reports the lip as inactive (`lipDisabled`) where beta.3 reported a palette lip for three of the four (both Anamnesis files and the Ktisis file). A local beta.4 tarball therefore gives different appearance results from the pinned beta.3; whether the target moves to beta.4 once it is published, verified and aged is the maintainer's decision.

For local development, run `pnpm test:package` to build and validate `.superpowers/package-smoke/xivcharakit-0.1.0-beta.4.tgz`. A fresh local consumer can install that tarball with `pnpm add <absolute-tarball-path>`. The artifact name follows the committed library version; a local tarball is not a replacement for reviewing the registry dependency used in the target's release.

```ts
import { readChara, inspectChara } from 'xivcharakit';
import { createDefaultPaletteProvider } from 'xivcharakit/palettes';
import { resolveAppearance } from 'xivcharakit/appearance';
import { createDyeNameResolver } from 'xivcharakit/dyes';
import { createXivapiResolver } from 'xivcharakit/xivapi';

const inspection = inspectChara(readChara('{"LEyeColor":0}'));
const appearance = await resolveAppearance(inspection, {
  palettes: createDefaultPaletteProvider(),
});
const dyes = createDyeNameResolver({ languages: ['en'] });
// After an explicit lookup action: await dyes.resolve([3]);
// Only call the resolver after an explicit host action, with validated model IDs.
const resolver = createXivapiResolver();
```

See [API semantics](docs/api.md) and [candidate resolution](docs/xivapi.md) before adapting a host. An empty or incomplete lookup is not always a definitive item absence, and matching models do not identify the original inventory item. Missing fields, nulls, valid zero and invalid values remain distinct. The library does not repair the source document.

## Host responsibilities

- Preserve each host's admission policy. The library's default is 8 MiB; adopting it must not silently replace XIV Dye Tools' existing 8 KiB host limit.
- Keep session state, authentication, localization, themes, collections, community submission, acquisition/regional enrichment and caches in their current hosts. Do not create a dependency cycle through `@xivdyetools/core`.
- Retain published core API compatibility until an explicit semver/migration decision. This package provides inspection, not editing or writing.
- Pass only validated worn model identifiers and optional facewear IDs to lookup. The separate dye-name resolver accepts validated Stain IDs after an explicit action. Never forward the source document, nickname/author, file name or unrelated appearance values.
- Enforce worker/process isolation, concurrency limits, safe rendering and cancellation in the host. The synchronous library is not a hard CPU or memory sandbox.
- Run fixture parity and affected web/bot integration checks, review intentional color/partial-document policy differences, and handle every candidate/failure status before replacing a consumer.

Preserve the published package's complete MIT license, third-party/data notices and Square Enix disclaimer in consumer distributions. The library's manual release path is established; target package publication and app deployment still follow XIV Dye Tools' own release process. No target publication, deployment, implementation or removal of old APIs is authorized by these planning notes.
