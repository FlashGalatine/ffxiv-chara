# Optional XIVAPI transport

The optional `xivcharakit/xivapi` export provides `createXivapiResolver`, `createXivapiClient`, `createMemoryCache`, the `XivapiInputError` class, and their types. Tasks 5–6 implement transport/cache and candidate matching. Importing the export or creating a client/resolver performs no I/O. The adapter has no runtime dependencies and uses standard fetch, readable streams, URL, and AbortSignal APIs.

```ts
import { createXivapiClient, createMemoryCache } from 'xivcharakit/xivapi';

const client = createXivapiClient({ cache: createMemoryCache() });
// Run after the host's explicit equipment-lookup action.
const items = await client.searchItems([{ slot: 'Body', base: 361, variant: 5 }]);
const facewear = await client.getGlasses(8);
```

`searchItems(models, { signal? })` accepts known slots with validated uint16 lanes. At most 24 supplied entries collapse to twelve unique slot/key lookups; conflicting models for one slot are invalid. Validated scalar identities are captured before asynchronous work. Queries use fixed grammar and encoded decimal packed keys, including weapon triples. Extra properties never reach requests. `getGlasses(id, { signal? })` accepts uint16 row IDs and uses `sheet/Glasses?rows=id`. Absence is proven by a validated successful empty list or by XIVAPI's missing-row 404 for exactly that Glasses row (see [Stain names](#stain-names)); any other HTTP 404 can describe a bad endpoint/version/schema and stays unavailable.

Both return `LookupResult` with detached rows ordered by row ID, canonical upstream `version`/`schema` or null, bounded issues, and status:

| Status | Meaning |
| --- | --- |
| `complete` | All pages and received rows passed validation; an empty set is definitive for this lookup/version |
| `partial` | Valid associated rows were retained, but a page, row, budget or upstream check prevented completeness |
| `unavailable` | An incomplete lookup retained no valid associated rows |
| `cancelled` | This subscriber cancelled; no rows are returned to it |

Item rows retain decimal `modelMain`, nullable `modelSub`, supported slots, selected localized names, numeric icon reference, nullable level/UI category, and rules. Missing/invalid rule values stay null; missing race/gender columns stay absent from `rules.wear`. This layer does not select preferred candidates, infer eligibility/acquisitions/off-hand relationships, or fetch icons. Names are untrusted text. Invalid/conflicting/unassociated rows prevent completeness.

## Host options

| Option | Default and accepted values |
| --- | --- |
| `baseUrl` | `https://v2.xivapi.com/api`; trusted custom HTTPS API root with no credentials/query/fragment |
| `version` | `latest`; 1–64 ASCII letters/digits/dots/underscores/hyphens, starting with a letter or digit |
| `schema` | `exdschema@2:ver:request`, or `exdschema@2:rev:` plus 1–40 lowercase hexadecimal digits |
| `languages` | en/ja/de/fr; 1 to 4 entries (counted before duplicates are removed, a hole is invalid), deduplicated and sorted |
| `timeoutMs` | 10,000; positive integer up to 10,000, covering headers and body |
| `maxPages` | 20; positive integer up to 20 |
| `fetch` / `cache` | Optional trusted host adapters; no implicit cache. A cache needs both `get` and `set`; they are read once when the client is created and called on the cache object, so replacing them later has no effect |

Invalid host options throw `XivapiInputError` (`INVALID_OPTIONS`); invalid direct identifiers throw `INVALID_LOOKUP` before requests. Upstream issue codes include `NETWORK_ERROR`, `TIMEOUT`, `DEADLINE`, `UPSTREAM_UNAVAILABLE`, `REDIRECT_REFUSED`, `BODY_UNAVAILABLE`, `MALFORMED_RESPONSE`, `RESPONSE_IDENTITY`, `INVALID_ROW`, `CONFLICTING_ROW`, `INVALID_CURSOR`, `REPEATED_CURSOR`, `PAGE_LIMIT`, `ROW_LIMIT`, `REQUEST_LIMIT`, `RESPONSE_LIMIT`, `RETRY_LIMIT`, `QUEUE_FULL`, and `CANCELLED`. Native errors and upstream error bodies are never quoted.

Requests omit credentials, use no-referrer policy/manual redirects, and send only `Accept: application/json`. No authorization or forbidden browser User-Agent is set. Injected fetch can change behavior and remains host responsibility. Document/file names, authors, character identity and unrelated appearance values are not accepted by the lookup contract. Optional Stain-name requests accept only validated dye IDs; these join equipment identifiers as explicitly requested outbound inputs. Equipment identifiers can still be distinctive and upstream sees ordinary connection metadata. Custom endpoint support is not an SSRF firewall: server hosts must restrict any configuration exposed to untrusted callers.

## Work and response bounds

Page limits count item-search cursor pages. A whole resolution permits at most twenty search pages plus one nonpaginated facewear sheet response, within its combined forty-request budget.

An operation includes version lookup, queueing, cache calls, pages and retry backoff: 30 seconds, 40 requests, and at most 20 pages. Each host cache call is also capped at `timeoutMs`: a `get` that has not settled by then is a miss and the lookup goes on to the network, and the write after a complete lookup is best effort, so a rejecting, hanging or too-slow `set` never lowers a complete result (the operation deadline included). After one cache call times out, the rest of that operation, including the other component of a whole resolution, skips the cache so a hung adapter costs at most one timeout. Caller cancellation still wins over a pending cache call. A client instance permits two active operations and sixteen queued operations. Equivalent lookups coalesce with independent subscriber cancellation and detached results. Shared transport aborts when the last subscriber cancels or its deadline expires. A late subscriber inherits the remaining deadline. The row-list 404 described under [Stain names](#stain-names) is not a retry: each missing row costs at most one more request. Retry once for 429/503 only; absent Retry-After uses 250 ms, while a supplied delay must be delay-seconds (digits with an optional fraction) or an HTTP date in the IMF-fixdate form (`Thu, 01 Jan 2026 00:00:01 GMT`), finite and at most two seconds away; any other form (a sign, an ISO date, an RFC 850 or asctime date, a unit) is `RETRY_LIMIT`, because `Date.parse` reads such strings differently in different engines. Cancellation, other HTTP errors and redirects are never retried. A redirect is refused with `REDIRECT_REFUSED` whether the runtime returns the 3xx response (Node) or an opaque redirect with no body (browsers).

Bodies require bounded readable streams: 2 MiB per response, 10 MiB aggregate exposed decoded chunks including errors/retries. Failure cancels consumption; no unbounded JSON fallback. The shared bounded parser admits depth 32, 100,000 nodes including properties, keys of 1,024 and ordinary strings of 65,536 code units, with duplicate decoded key rejection and finite/safe-integral number rules before building an over-limit graph. API Base64Image keys receive ordinary limits, without the character reader's omission exception. Rows are limited to 500 per page and 5,000 encountered per operation including duplicates, names to 1,024, and opaque cursors to 2,048 code units. These are resource controls, not hard heap/CPU guarantees; async deadlines cannot preempt synchronous admitted parsing.

## Row cache contract

`ResolutionCache.get(key)` and `set(key, CachedRows, ttlMs)` store normalized public rows, never character selections. Namespace format 1 includes API root, immutable version, canonical schema, field/locale selection and the sorted slot/model set or glasses ID. Grouped keys keep an incomplete group from becoming a complete miss. Canonical version keys are sixteen lowercase hexadecimal digits; canonical schemas use full forty-digit revisions. Aliases resolve via `/version` and refresh after ten minutes. Failed refresh discards stale mappings and cannot read previous-version cache entries. Moving schemas also refresh after ten minutes; continuation pins the first canonical response schema. Inconsistent/invalid response identities are incomplete. Failed version resolution permits alias requests, but storage still requires canonical response identities and alias-keyed cache reads never occur.

Only complete positive sets use seven-day TTL and complete empty sets ten minutes; partial/failed/cancelled sets are never cached. Inputs undergo iterative structural/JSON-shape/cycle admission before copying/serialization, then identity/completeness/association/row checks. Invalid entries, including one whose rows are not in strictly ascending row order, are misses; oversized complete results remain usable without caching. Cache errors cannot manufacture complete data. The optional memory cache caps 128 LRU entries and 8 MiB serialized data including keys, with TTL and detached values. Custom adapters own capacity/storage policy. Object property order does not affect validity; unknown/invalid fields remain rejected.

Protocol references, verified 2026-10-19: official [search/pagination](https://v2.xivapi.com/docs/guides/search/), [fields/languages/row lists](https://v2.xivapi.com/docs/guides/sheets/), [pinning](https://v2.xivapi.com/docs/guides/pinning/), and [OpenAPI](https://v2.xivapi.com/api/openapi.json); commit-pinned source conventions are linked in the implementation plan. [Installed-package consumers](security/distribution-validation.md) now verify the mocked contract in Node/Node Worker, Chromium/module Web Worker and local workerd. Task 7's [live browser check](demo.md#live-integration-evidence) verified direct CORS, canonical upstream identities, and two icons from localhost in Chromium. The deployed origin was accepted on 2026-10-22, including direct CORS from that origin ([Cloudflare hosting](cloudflare-hosting.md#deployment-verified-on-2026-10-22)); recheck it after hosting or upstream changes.

## Cloudflare Workers

A Worker request runs in its own I/O context. A client or resolver kept in module scope shares one scheduler between requests: a lookup that joins another request's in-flight lookup, and a queued lookup that another request's completion starts, depend on promises and timers that belong to a request that may already be over.

Reproduced under local workerd on 2026-10-23 with a module-scope client and an upstream that takes 1.5 s (a stand-in with real timers, no network):
- Three simultaneous lookups for different IDs: the third was queued and its request ended after 30 s with "the Worker's code had hung". The runtime logged a promise resolved from a different request context than the one that created it.
- The scheduler's slots were then never released: a later request on the same isolate, for a new ID and with nothing else running, failed with `DEADLINE` after 30 s.
- Two requests for the same IDs, and a client disconnecting while another request waited on its lookup, completed normally in that run.

Creating the client in each request completed every one of those scenarios, including disconnected clients and a later request. So on Workers (and any runtime that ties promises or timers to a request):
- Call `createXivapiClient`, `createXivapiResolver` or `createDyeNameResolver` inside the request handler.
- Share only the data cache: create one `createMemoryCache()` at module scope and pass it as `cache`. Otherwise `createDyeNameResolver` builds a new cache on every call.
- Lookups for the same IDs in different requests then run separately, and `version: 'latest'` costs one version request per request unless you pin a version.
- A new client remembers no earlier schema answer, so it reads that shared cache only when `schema` is pinned to an `exdschema@2:rev:<40 hex digits>` revision; with the default `exdschema@2:ver:request` every request goes to XIVAPI and the cache is only written. Pin `schema`, and `version` to skip the per-request version call, to get cache hits across requests.

Node and browsers are unaffected, and the demo runs in the browser.

## Equipment candidate resolution

`createXivapiResolver(options?: XivapiOptions): EquipmentResolver` uses the same host configuration and bounds as the low-level client. Its `resolve(input: EquipmentResolveInput, options?: { signal?: AbortSignal }): Promise<EquipmentResolution>` accepts only `models` and optional `glassesId`. Call it after an explicit host lookup action. Pass inspected worn models; no document or character information is required. All identifiers and request options are validated before I/O. A `signal` must be `undefined` or an `AbortSignal`-compatible object (a boolean `aborted` plus `addEventListener` and `removeEventListener`), from this realm or another; anything else, including `null`, throws `INVALID_LOOKUP` before a request is made. `searchItems`, `getGlasses` and `getStains` apply the same check. Empty models with no facewear perform no I/O. A requested zero ID/model remains an explicit lookup; the resolver does not turn zero into absent input.

Each requested slot appears in `result.items` with a detached `model`, decimal `modelKey`, status, `ambiguous`, and all `candidates` in ascending item ID order. Only received candidates are known: `ambiguous: false` with an incomplete status does not prove uniqueness. Candidate fields are `itemId`, localized `names`, `iconId`, nullable `levelEquip`/`uiCategory`, nullable/partial `rules`, and `viaMainHand`. Matching a model identifies possible items, not the original inventory identity. No preferred twin, eight-alternate cap, retired-name filtering, inferred acquisition, or job/race eligibility decision is imposed. Unobtainable-looking names remain candidates without guessed retirement metadata; missing rule evidence remains unknown.

`result.facewear` is null only when no ID was requested. Otherwise it contains `id`, status, and normalized Glasses candidates (`rowId`, names, iconId). `result.upstream.items` and `.facewear` each contain version/schema evidence, or null for an unrequested component; requested failures can have null identities. Do not combine these into an invented common version. If a changing alias cannot be resolved and the two responses differ, both identities remain visible. Component outages do not hide successful results from the other component. Issues are merged under `items`/`facewear` paths and remain capped at 64 with a truncation marker.

| Status | Meaning |
| --- | --- |
| `matched` | Complete evidence produced at least one candidate |
| `notFound` | A complete successful lookup produced no candidate for this input; the stored identifier is retained |
| `partial` | Some evidence is incomplete; this includes an empty slot within a batch that retained rows elsewhere |
| `unavailable` | The lookup could not retain valid row evidence |
| `cancelled` | This caller cancelled; no candidate results are returned to it |

Pure matching first associates item rows by both slot and packed model. Shared armor keys cannot cross slots, while ring rows can match both requested ring slots. Main-hand candidates are matched to the requested main-hand key. For an off-hand, only those main-hand rows whose `ModelSub` equals the off-hand key are paired; a copied main-hand key also pairs. The all-zero off-hand key `"0"` means nothing is equipped and never pairs, even with a main hand whose `ModelSub` is 0 (XIVAPI's "no sub-model" value); hosts are still told not to send empty slots. Paired candidates take priority over standalone OffHand rows and carry `viaMainHand: true`. Other main-hand families sharing that ModelSub never enter the search. If no contextual candidate pairs, direct OffHand matching provides shields and other independent models. Missing main-hand `ModelSub` leaves off-hand status partial with `INCOMPLETE_OFFHAND_CONTEXT`, including when no candidate was retained. Absent main-hand input permits only direct OffHand matching. Partial upstream batches stay partial for every requested slot, even slots with no candidates; an outage never becomes notFound.

One resolve call owns one coalesced queue entry, 30-second deadline, and combined 40-request/10-MiB/5,000-encountered-row budget across item and facewear lookup, including version resolution, cache reads, retries and queue time. Items run before facewear inside that operation; at most two operations can consume requests at once and sixteen can wait. Successful earlier components remain usable if a later component fails. Caller cancellation interrupts the entire operation independently of other subscribers. The shared cache stores upstream model rows only; off-hand selections are recalculated with the current main hand on every resolve, and final character-specific selections are never cached.

## Stain names

`createXivapiClient().getStains(ids, { signal })` accepts at most 64 uint16 Stain row IDs per input array, deduplicates/sorts them and selects only localized names. The optional [`createDyeNameResolver`](api.md#cached-dye-names) provides a default bounded memory cache. No names are bundled; IDs remain local until a host explicitly requests resolution. Complete, partial, unavailable and cancelled results carry their own version/schema, independently of equipment results. Blank names remain explicit, and missing rows in partial/failing responses must not become definitive absence. XIVAPI answers a row list that names a missing row with HTTP 404 for the whole request, naming the first such row (checked 2026-10-23). The client recognises exactly that answer for the Stain and Glasses sheets (the row ID without leading zeros, subrow 0), drops the named row and asks again for the rest, so a missing row is absent from an otherwise complete result and costs at most one extra request, inside the forty-request budget. A 404 that names a missing sheet, another sheet, a row that was not asked for, or anything else, is still an upstream failure. Because that 404 names no version, a row is dropped only when the request is pinned to a canonical version (an unresolved alias such as `latest` makes it a failure), and a dropped row that reappears in a later answer is rejected with `INVALID_ROW`. When every requested row is missing, the result is complete and empty; its `version` is the pinned canonical version and its `schema` is the schema pin when that is canonical, each otherwise null, and it is cached only when both are set.

Stain lookups share the client instance's existing scheduler, budgets, alias/schema memoization, retries, cancellation and validated cache path. They use a distinct selection and fields namespace. Only rows for requested IDs are accepted; malformed/conflicting rows and unexpected pagination prevent a complete cache entry. `UNEXPECTED_PAGINATION` identifies an incomplete known-ID batch. Positive cache duration is seven days, empty complete batches ten minutes; different ID batches/languages/upstream identities have distinct keys. The demo reuses one English dye resolver in page memory and sequences dye lookup before equipment lookup to preserve request concurrency limits. Each component retains its own operation deadline and evidence.
