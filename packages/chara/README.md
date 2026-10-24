# XIVCharaKit

Read and inspect Final Fantasy XIV `.chara` files from Anamnesis, Ktisis and Brio. A portable TypeScript library with ESM exports, declarations and zero runtime dependencies.

This package is **0.1.0-beta.4**. The API and compatibility coverage may change. Install the beta selected by the `next` tag:

```sh
npm install xivcharakit@next
```

```ts
import { readChara, inspectChara, modelKey } from 'xivcharakit';

const inspection = inspectChara(readChara(
  '{"Body":{"ModelBase":361,"ModelVariant":5,"DyeId":3}}',
));
const body = inspection.equipment.Body;
if (body.model) console.log(modelKey(body.model)); // "328041"
```

## Exports

| Import | Purpose |
| --- | --- |
| `xivcharakit` | Bounded reading, typed inspection and model identifiers |
| `xivcharakit/palettes` | Lazy creator/shader palette provider |
| `xivcharakit/appearance` | Source-labelled appearance interpretation |
| `xivcharakit/dyes` | Optional cached XIVAPI dye-name lookup |
| `xivcharakit/xivapi` | Optional equipment candidates, transport and caching |

```ts
import { createDefaultPaletteProvider } from 'xivcharakit/palettes';
import { resolveAppearance } from 'xivcharakit/appearance';

const appearance = await resolveAppearance(inspection, {
  palettes: createDefaultPaletteProvider(),
});
console.log(appearance.slots.hair);
```

Reading, inspection and bundled appearance lookup perform no network or storage operations. Embedded image fields are omitted. Remaining file values are untrusted; hosts must set suitable resource limits and should use a Worker for browser parsing. The optional equipment and dye-name resolvers send their respective identifiers when explicitly called. Matching candidates do not identify a unique inventory item.

Beta.3 adds the legacy tribe alias `Helion` → `Helions`, preserving the stored spelling and deriving Hrothgar identity for appearance lookup. Numeric tribe IDs and existing public API signatures are unchanged.

Beta.4 reads the lip-color bit of `Mouth` and the mirror bit of `FacePaint` (appearance policy `1.1.0`: `AppearancePolicy.version` is typed `'1.1.0'` and `AppearanceReason` gains `lipDisabled`), and tightens input handling and the XIVAPI client; the repository changelog lists each change.

Bundles target ES2022. Installed-package checks cover Node, Node Worker, Chromium, module Web Worker and local workerd across all five exports, including declarations in an external consumer. This is evidence for tested environments, not all browsers or game versions. CommonJS, editing and writing character files are not provided. Appearance palettes record game version 7.57; dye-name results record their own upstream version/schema. See the [API](https://github.com/FlashGalatine/XIVCharaKit/blob/main/docs/api.md), [compatibility evidence](https://github.com/FlashGalatine/XIVCharaKit/blob/main/docs/compatibility.md), [data provenance](https://github.com/FlashGalatine/XIVCharaKit/blob/main/docs/data-provenance.md), [equipment/privacy contract](https://github.com/FlashGalatine/XIVCharaKit/blob/main/docs/xivapi.md) and [security policy](https://github.com/FlashGalatine/XIVCharaKit/blob/main/SECURITY.md).

Resolve names after an explicit host action:

```ts
import { createDyeNameResolver } from 'xivcharakit/dyes';
const dyes = createDyeNameResolver({ languages: ['en'] });
const result = await dyes.resolve([3, 10]);
// result.rows: { rowId, names }; result.status/version/schema/issues retain evidence.
// Reuse this resolver for its bounded default memory cache. On Cloudflare Workers create it per request and share only a cache:
// https://github.com/FlashGalatine/XIVCharaKit/blob/main/docs/xivapi.md#cloudflare-workers
```

No dye-name snapshot is bundled. Names require API availability or a successful cached response; stored IDs remain usable offline. The former synchronous `getDyeName` and `DYE_METADATA` exports were removed before publication. Blank names, missing rows and failed lookups remain distinct.

## License and attribution

Original code is MIT-licensed; the complete license and third-party notices are included at `dist/LICENSE` and `dist/THIRD_PARTY_NOTICES.md`. Game-derived materials have separate rights and are not covered by the MIT code license. FINAL FANTASY XIV © SQUARE ENIX. This independent community project is not affiliated with, sponsored by, or endorsed by Square Enix.
