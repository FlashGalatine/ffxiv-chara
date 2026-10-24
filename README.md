# XIVCharaKit

A TypeScript library in development for reading and inspecting Final Fantasy XIV `.chara` files used by Anamnesis, Ktisis, and Brio.

**Status: npm beta.3 published; beta.4 prepared for review.** Bounded reading, typed inspection, creator/shader palettes, source-labelled swatches, and optional XIVAPI equipment candidates with caching and explicit failure states are available. Original code is MIT-licensed. `xivcharakit@0.1.0-beta.3` was published on 2026-10-22 through GitHub Actions and the registry lists signed provenance; it adds legacy `Helion` tribe normalization. The dist-tags are `next` → beta.3 and `latest` → beta.1. The beta.4 candidate carries the appearance policy `1.1.0` and the XIVAPI, input and inspection fixes recorded in the [changelog](CHANGELOG.md); preparing or merging its pull request does not publish it. The maintainer elected to retain bundled appearance palettes with separate notices and provenance. GitHub release protections and npm trusted publishing are configured; releases remain manual and require approval. See the [manual publication runbook](docs/npm-publication-readiness.md). The repository is [FlashGalatine/XIVCharaKit](https://github.com/FlashGalatine/XIVCharaKit); see the [rename record](docs/rename-preparation.md).

The full MVP includes:

- Typed inspection of character appearance, equipment, dye channels, and facewear.
- Appearance swatches backed by versioned creator and shader palettes.
- Optional cached XIVAPI dye names alongside both stored dye IDs, without a bundled name dataset.
- Optional XIVAPI equipment resolution with matching candidates and explicit failure states.
- A small website demonstrating the library's public API with local files and synthetic examples.

The demo is verified in Chromium with a module Web Worker. Installed-tarball checks cover Node, Node Worker, Chromium, module Web Worker and local workerd across all five exports. CI is configured for Ubuntu and Windows; hosted results are separate from local evidence. Editing and writing `.chara` files are deferred to a later version. Try the [live demo](https://charakit.projectgalatine.com), hosted with Workers Static Assets; see [Cloudflare hosting and deployment](docs/cloudflare-hosting.md). Beta.2 retained the beta.1 library API and behavior; beta.3 keeps the public API signatures and adds the `Helion` normalization.

## License and attribution

Original library, demo and tooling code is covered by the [MIT license](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for upstream attribution and separate data rights. FINAL FANTASY XIV © SQUARE ENIX. This independent community project is not affiliated with, sponsored by, or endorsed by Square Enix. Game-derived materials are not covered by the MIT code license.

## Develop locally

Use Node 22.21.0 and pnpm 10.27.0 (pinned in the repository).

```sh
pnpm install --frozen-lockfile
pnpm --filter @xivcharakit/demo exec playwright install chromium
pnpm test
pnpm type-check
pnpm lint
pnpm verify-fixtures
pnpm verify-palettes
pnpm test:package
```

`pnpm test:package` builds and packs the candidate locally, checks the tarball and static demo artifacts, and exercises installed JavaScript/TypeScript plus Node, Node Worker, Chromium, module Web Worker and local workerd consumers outside the workspace. It does not publish. `pnpm test` includes artifact/release-policy tooling, library units and demo browser scenarios. `pnpm benchmark` measures synthetic reader cases in isolated Node processes. See [contributor setup](CONTRIBUTING.md), [distribution validation](docs/security/distribution-validation.md), [security/reporting status](SECURITY.md), [changelog](CHANGELOG.md), and [future migration notes](migration.md).

Start the demo with `pnpm dev`, or run `pnpm build` followed by `pnpm preview` for the production artifact at `http://127.0.0.1:4173`. Files stay in memory; equipment lookup requires a separate click. The default tests mock upstream responses. See [demo setup and validation](docs/demo.md) for the opt-in live check, privacy limits, and preview headers.

```ts
import { readChara, inspectChara, modelKey } from 'xivcharakit';

const document = readChara('{"Body":{"ModelBase":361,"ModelVariant":5,"DyeId":0}}');
const inspection = inspectChara(document);
const body = inspection.equipment.Body;
if (body.model) console.log(modelKey(body.model)); // "328041"
```

Optional appearance interpretation uses separate exports:

```ts
import { createDefaultPaletteProvider } from 'xivcharakit/palettes';
import { resolveAppearance } from 'xivcharakit/appearance';

const appearance = await resolveAppearance(inspection, {
  palettes: createDefaultPaletteProvider(),
});
const hair = appearance.slots.hair;
// creatorHex, shaderHex, extendedHex, interpretation and displayHex; diagnostics are on appearance.issues
```

Install the public beta with `npm install xivcharakit@next`, or use the checked tarball in a local consumer. Reading, inspection, bundled palette lookup, and appearance interpretation perform no network or storage operations. Main-entry imports exclude optional code/data; palette tables load only when requested. Embedded image fields are omitted; all remaining stored values are untrusted data.

Dye names use an explicit optional lookup, separate from local inspection:

```ts
import { createDyeNameResolver } from 'xivcharakit/dyes';
const dyes = createDyeNameResolver({ languages: ['en'] });
const names = await dyes.resolve([3, 10]);
// names.rows: { rowId, names }; status/version/schema/issues retain evidence.
// Reuse the resolver for its bounded default memory cache (on Cloudflare Workers, create it per request and share only a cache: docs/xivapi.md#cloudflare-workers).
```

The demo shows `No dye (0)` for valid zero and raw IDs before lookup. **Resolve equipment and dye names** requests names; blank, missing and unavailable results remain distinct. Original stored fields are preserved. No name snapshot is bundled; see [dye provenance](docs/data-provenance.md#dye-names-through-xivapi). The synchronous `getDyeName` and `DYE_METADATA` exports were removed before publication.

Equipment lookup is an explicit optional action:

```ts
import { createXivapiResolver, createMemoryCache } from 'xivcharakit/xivapi';

const resolver = createXivapiResolver({ cache: createMemoryCache() });
const result = await resolver.resolve({
  models: [{ slot: 'Body', base: 361, variant: 5 }],
});
// result.items.Body: status, original model identity, all sorted candidates,
// and ambiguity; result.facewear and upstream evidence are separate.
```

This equipment resolver sends only equipment identifiers; the separate dye-name resolver accepts Stain IDs. Matching candidates do not establish which inventory item was saved. See [equipment resolution](docs/xivapi.md#equipment-candidate-resolution) for off-hand matching, incomplete results, privacy, and resource limits. A synthetic browser lookup verified direct CORS from the public demo hostname on 2026-10-22.

The local sample checker accepts `--appearance` to include aggregate swatch results. It never copies samples or records per-character values. Regeneration from the maintainer-supplied `human.cmp` exactly matches all four committed palette tables; source hashes and the maintainer-confirmed game version 7.57 are recorded.

See [API and limits](docs/api.md), [compatibility evidence](docs/compatibility.md), [source/data provenance](docs/data-provenance.md), [security requirements](docs/security/THREAT_MODEL.md), and [implementation progress](docs/implementation-progress.md). The [MVP plan](docs/plans/2026-10-19-chara-library-mvp.md) retains the full roadmap.
