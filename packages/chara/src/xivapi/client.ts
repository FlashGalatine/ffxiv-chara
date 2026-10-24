import { isRecord } from '../field-spec.js';
import { IssueCollector } from '../issues.js';
import { readBoundedJson } from '../read.js';
import { asBytes } from '../realm.js';
import type { EquipmentModel } from '../types.js';
import { admittedJson } from './cache.js';
import {
  buildQuery,
  canonicalSchema,
  canonicalVersion,
  fieldsFor,
  isStainLookup,
  LANGUAGES,
  type LookupSelection,
  lookupsFrom,
  type SlotLookup,
  signalFrom,
  stainsFrom,
  XivapiInputError,
} from './query.js';
import {
  associated,
  cachedRow,
  cachedStainRow,
  normalizeRow,
  normalizeStainRow,
} from './rows.js';
import type {
  CachedRows,
  GlassesRow,
  ItemRow,
  Language,
  LookupResult,
  PublicRow,
  StainRow,
  XivapiClient,
  XivapiOptions,
} from './types.js';

/**
 * The two forms of Retry-After that are waited for: delay-seconds (with an optional fraction) and an
 * HTTP date in the IMF-fixdate form. Date.parse accepts many more strings and reads them differently
 * in different engines ("-1" and "+1" are 1 January 2001 in V8), so everything else is refused.
 */
const DELAY_SECONDS = /^\d+(?:\.\d+)?$/;
const IMF_FIXDATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

class Failure extends Error {
  constructor(readonly code: string) {
    super('XIVAPI lookup interrupted.');
  }
}
const failureResult = (code: string, cancelled = false): LookupResult => ({
  status: cancelled ? 'cancelled' : 'unavailable',
  rows: [],
  version: null,
  schema: null,
  issues: [
    {
      code,
      severity: 'warning',
      path: [],
      message: 'Equipment lookup could not complete.',
    },
  ],
});
function reason(signal: AbortSignal): Failure {
  return signal.reason instanceof Failure
    ? signal.reason
    : new Failure('CANCELLED');
}
/**
 * The row ID that a 404 from a row-list request names as missing, or undefined when the body is
 * anything else (a missing sheet, another sheet's row, an unknown shape). The message is matched,
 * never quoted or returned, and an oversized body is not trusted.
 */
function missingRowIn(body: Uint8Array, sheet: string): number | undefined {
  if (body.byteLength > 4096) return undefined;
  let data: unknown;
  try {
    data = readBoundedJson(body);
  } catch {
    return undefined;
  }
  if (!isRecord(data) || data.code !== 404 || typeof data.message !== 'string')
    return undefined;
  const match = new RegExp(
    `^not found: the Excel row ${sheet}/(0|[1-9]\\d{0,4}):0 could not be found$`,
  ).exec(data.message.length <= 256 ? data.message : '');
  const id = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(id) && id <= 65535 ? id : undefined;
}
function joined(chunks: Uint8Array[], bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
/** Race even uncooperative host promises, and always remove listeners. */
function interruptible<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(reason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(reason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
/**
 * A host cache call gets the per-request timeout on top of the operation's own signal. A call
 * that hangs is a miss or a failed write, never a failed lookup.
 */
function cacheCall<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  ms: number,
): Promise<T> {
  const local = new AbortController();
  const abort = () => local.abort(reason(signal));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => local.abort(new Failure('CACHE_TIMEOUT')), ms);
  return interruptible(promise, local.signal).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  });
}
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await interruptible(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
interface Budget {
  /** A host cache call timed out: skip further cache calls in this operation. */
  cacheDown: boolean;
  requests: number;
  bytes: number;
  rows: number;
  signal: AbortSignal;
}
interface Job {
  controller: AbortController;
  promise: Promise<unknown>;
  finish(result: unknown): void;
  run(): Promise<unknown>;
  failure(code: string, cancelled?: boolean): unknown;
  subscribers: number;
  started: boolean;
  expires: number;
}

interface ResolvedRows {
  items: LookupResult<ItemRow> | null;
  facewear: LookupResult<GlassesRow> | null;
}
interface Transport extends XivapiClient {
  resolveRows(
    models: readonly EquipmentModel[],
    glassesId: number | undefined,
    signal?: AbortSignal,
  ): Promise<ResolvedRows>;
}
const newBudget = (signal: AbortSignal): Budget => ({
  signal,
  cacheDown: false,
  requests: 0,
  bytes: 0,
  rows: 0,
});

const OPTION_KEYS = [
  'fetch',
  'baseUrl',
  'version',
  'schema',
  'languages',
  'maxPages',
  'timeoutMs',
  'cache',
] as const;

/** Internal shared scheduler for both the low-level client and whole resolutions. */
export function createTransport(given: XivapiOptions = {}): Transport {
  const invalid = (): never => {
    throw new XivapiInputError('INVALID_OPTIONS');
  };
  if (typeof given !== 'object' || given === null || Array.isArray(given))
    return invalid();
  // Each option is read once, and a getter that throws makes the options invalid, as it does for
  // createDyeNameResolver. The same goes for what an option holds: the languages are copied by index
  // after a check of their length (a getter that throws is caught here, at creation; a hole becomes
  // undefined and fails the language check below) and the cache's two methods are read once and called
  // on the cache, which may rely on this.
  const options: XivapiOptions = {};
  try {
    for (const key of OPTION_KEYS) {
      const value = given[key];
      if (value !== undefined) Object.assign(options, { [key]: value });
    }
    if (Array.isArray(options.languages)) {
      const length = options.languages.length;
      if (!Number.isInteger(length) || length < 1 || length > 4)
        return invalid();
      const copy: unknown[] = [];
      for (let i = 0; i < length; i++) copy.push(options.languages[i]);
      options.languages = copy as Language[];
    }
    if (typeof options.cache === 'object' && options.cache !== null) {
      const target = options.cache;
      const get = target.get;
      const set = target.set;
      if (typeof get !== 'function' || typeof set !== 'function')
        return invalid();
      options.cache = {
        get: (key) => get.call(target, key),
        set: (key, value, ttlMs) => set.call(target, key, value, ttlMs),
      };
    }
  } catch {
    return invalid();
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl ?? 'https://v2.xivapi.com/api');
  } catch {
    return invalid();
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.hash ||
    base.search
  )
    return invalid();
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  const version = options.version ?? 'latest';
  const schema = options.schema ?? 'exdschema@2:ver:request';
  if (
    typeof version !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version) ||
    typeof schema !== 'string' ||
    !/^exdschema@2:(ver:request|rev:[a-f0-9]{1,40})$/.test(schema)
  )
    return invalid();
  const maxPages = options.maxPages ?? 20;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 20 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10_000
  )
    return invalid();
  const selected = options.languages ?? LANGUAGES;
  if (
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 4 ||
    selected.some((l) => !LANGUAGES.includes(l))
  )
    return invalid();
  const languages: Language[] = [...new Set(selected)].sort();
  const fetcher = options.fetch ?? globalThis.fetch;
  if (
    typeof fetcher !== 'function' ||
    (options.cache !== undefined &&
      (options.cache === null ||
        typeof options.cache !== 'object' ||
        typeof options.cache.get !== 'function' ||
        typeof options.cache.set !== 'function'))
  )
    return invalid();
  const cache = options.cache;
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let active = 0;
  let alias: { version: string; expires: number } | undefined;
  const schemas = new Map<string, { schema: string; expires: number }>();

  async function request(
    url: URL,
    budget: Budget,
    rowSheet?: string,
  ): Promise<{ status: number; data: unknown; missingRow?: number }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (budget.signal.aborted) throw reason(budget.signal);
      if (budget.bytes > 10 * 1024 * 1024) throw new Failure('RESPONSE_LIMIT');
      if (budget.rows > 5000) throw new Failure('ROW_LIMIT');
      if (++budget.requests > 40) throw new Failure('REQUEST_LIMIT');
      const control = new AbortController();
      const abort = () => control.abort(reason(budget.signal));
      budget.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => control.abort(new Failure('TIMEOUT')),
        timeoutMs,
      );
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let retry: number | undefined;
      let consumed = false;
      try {
        const response = await interruptible(
          Promise.resolve().then(() =>
            fetcher(url, {
              method: 'GET',
              headers: { Accept: 'application/json' },
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
              redirect: 'manual',
              signal: control.signal,
            }),
          ),
          control.signal,
        );
        // A browser answers redirect: 'manual' with an opaque redirect that has no body.
        if (
          response.type === 'opaqueredirect' ||
          (response.status >= 300 && response.status < 400)
        ) {
          try {
            void response.body?.cancel().catch(() => {});
          } catch {
            // the body is not needed
          }
          throw new Failure('REDIRECT_REFUSED');
        }
        if (!response.body || typeof response.body.getReader !== 'function')
          throw new Failure('BODY_UNAVAILABLE');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
          const chunk = await interruptible(reader.read(), control.signal);
          if (chunk.done) {
            consumed = true;
            break;
          }
          const view = asBytes(chunk.value);
          if (!view) throw new Failure('BODY_UNAVAILABLE');
          bytes += view.byteLength;
          budget.bytes += view.byteLength;
          if (bytes > 2 * 1024 * 1024 || budget.bytes > 10 * 1024 * 1024)
            throw new Failure('RESPONSE_LIMIT');
          if (
            response.ok ||
            (rowSheet !== undefined && response.status === 404)
          )
            chunks.push(view);
        }
        if (response.status === 429 || response.status === 503) {
          if (attempt !== 0) throw new Failure('UPSTREAM_UNAVAILABLE');
          const raw = response.headers.get('Retry-After');
          retry =
            raw === null
              ? 250
              : DELAY_SECONDS.test(raw)
                ? Number(raw) * 1000
                : IMF_FIXDATE.test(raw)
                  ? Date.parse(raw) - Date.now()
                  : Number.NaN;
          if (!Number.isFinite(retry) || retry > 2000)
            throw new Failure('RETRY_LIMIT');
          retry = Math.max(0, retry);
        } else if (!response.ok) {
          // A row list that names a row the sheet lacks is answered with 404 for the whole
          // request, so the one missing row is learned from the message and dropped by the caller.
          const missingRow =
            rowSheet !== undefined && response.status === 404
              ? missingRowIn(joined(chunks, bytes), rowSheet)
              : undefined;
          if (missingRow === undefined)
            throw new Failure('UPSTREAM_UNAVAILABLE');
          return { status: 404, data: null, missingRow };
        } else {
          const buffer = joined(chunks, bytes);
          let data: unknown;
          try {
            data = readBoundedJson(buffer);
          } catch {
            throw new Failure('MALFORMED_RESPONSE');
          }
          return { status: response.status, data };
        }
      } catch (error) {
        if (control.signal.aborted) throw reason(control.signal);
        throw error instanceof Failure ? error : new Failure('NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
        budget.signal.removeEventListener('abort', abort);
        if (reader) {
          if (!consumed) void reader.cancel().catch(() => {});
          else reader.releaseLock();
        }
      }
      await delay(retry ?? 250, budget.signal);
    }
    throw new Failure('UPSTREAM_UNAVAILABLE');
  }

  async function resolvedVersion(budget: Budget): Promise<string | null> {
    if (canonicalVersion(version)) return version;
    if (alias && alias.expires > Date.now()) return alias.version;
    alias = undefined;
    try {
      const response = await request(new URL('version', base), budget);
      if (
        !isRecord(response.data) ||
        !Array.isArray(response.data.versions) ||
        response.data.versions.length > 500
      )
        return null;
      for (const entry of response.data.versions) {
        if (
          isRecord(entry) &&
          canonicalVersion(entry.key) &&
          Array.isArray(entry.names) &&
          entry.names.includes(version)
        ) {
          alias = { version: entry.key, expires: Date.now() + 600_000 };
          return entry.key;
        }
      }
    } catch (error) {
      if (budget.signal.aborted) throw error;
    }
    return null;
  }

  async function lookup(
    selection: LookupSelection,
    budget: Budget,
  ): Promise<LookupResult> {
    const { signal } = budget;
    const diagnostics = new IssueCollector();
    const rows = new Map<number, PublicRow>();
    let upstreamVersion: string | null = null;
    let upstreamSchema: string | null = null;
    let complete = true;
    const stains = isStainLookup(selection);
    const items = typeof selection !== 'number' && !stains;
    const fields = stains
      ? languages.map((language) => `Name@lang(${language})`).join(',')
      : fieldsFor(languages, items);
    const keyFor = (v: string, s: string) =>
      JSON.stringify([1, base.href, v, s, fields, selection]);
    try {
      if (signal.aborted) throw reason(signal);
      const pin = await resolvedVersion(budget);
      if (signal.aborted) throw reason(signal);
      const memo = pin ? schemas.get(pin) : undefined;
      const schemaPin = canonicalSchema(schema)
        ? schema
        : memo && memo.expires > Date.now()
          ? memo.schema
          : schema;
      const key =
        pin && canonicalSchema(schemaPin) ? keyFor(pin, schemaPin) : null;
      if (cache && key && !budget.cacheDown) {
        try {
          const hit: unknown = await cacheCall(
            cache.get(key),
            signal,
            timeoutMs,
          );
          const text = admittedJson(hit);
          const data: unknown = text === null ? null : JSON.parse(text);
          if (
            isRecord(data) &&
            data.format === 1 &&
            data.complete === true &&
            data.namespace === key &&
            data.version === pin &&
            data.schema === schemaPin &&
            Array.isArray(data.rows) &&
            data.rows.length <= 5000
          ) {
            const normalized: PublicRow[] = [];
            for (const raw of data.rows) {
              const row = stains
                ? cachedStainRow(raw, languages)
                : cachedRow(raw, languages, items);
              if (!row || !associated(row, selection)) break;
              normalized.push(row);
            }
            if (
              normalized.length === data.rows.length &&
              normalized.every(
                (r, i) => i === 0 || (normalized[i - 1]?.rowId ?? 0) < r.rowId,
              )
            ) {
              budget.rows += normalized.length;
              if (budget.rows > 5000) throw new Failure('ROW_LIMIT');
              return {
                status: 'complete',
                rows: normalized,
                version: pin,
                schema: schemaPin,
                issues: [],
              };
            }
          }
        } catch (error) {
          if (signal.aborted) throw reason(signal);
          if (error instanceof Failure && error.code === 'CACHE_TIMEOUT')
            budget.cacheDown = true;
        }
      }
      let cursor: string | undefined;
      const cursors = new Set<string>();
      // Rows still asked for: a row the API reports as missing is dropped and the rest retried.
      const wanted: number[] = stains
        ? [...selection.stains]
        : items
          ? []
          : [selection as number];
      const sheet = stains ? 'Stain' : items ? undefined : 'Glasses';
      const urlFor = () => {
        const url = new URL(
          stains ? 'sheet/Stain' : items ? 'search' : 'sheet/Glasses',
          base,
        );
        url.search = new URLSearchParams({
          fields,
          version: pin ?? version,
          schema: upstreamSchema ?? schemaPin,
          language: 'en',
          transient: '',
          ...(items
            ? {
                limit: '500',
                ...(cursor
                  ? { cursor }
                  : {
                      sheets: 'Item',
                      query: buildQuery(selection as readonly SlotLookup[]),
                    }),
              }
            : { rows: wanted.join(',') }),
        }).toString();
        return url;
      };
      for (let page = 0; page < maxPages; page++) {
        // A 404 names no version: with the alias unresolved a later 200 could describe another one.
        const rowSheet = pin !== null ? sheet : undefined;
        let response = await request(urlFor(), budget, rowSheet);
        while (response.missingRow !== undefined) {
          const at = wanted.indexOf(response.missingRow);
          if (at < 0) throw new Failure('UPSTREAM_UNAVAILABLE');
          wanted.splice(at, 1);
          if (!wanted.length) break;
          response = await request(urlFor(), budget, rowSheet);
        }
        if (response.missingRow !== undefined) {
          // Every requested row is missing. The answer names no version or schema, so only a
          // request that was already pinned can say which it applies to.
          upstreamVersion = canonicalVersion(pin) ? pin : null;
          upstreamSchema = canonicalSchema(schemaPin) ? schemaPin : null;
          break;
        }
        const data = response.data;
        if (
          !isRecord(data) ||
          !canonicalVersion(data.version) ||
          !canonicalSchema(data.schema) ||
          (pin !== null && data.version !== pin) ||
          (upstreamVersion !== null && data.version !== upstreamVersion) ||
          (canonicalSchema(schemaPin) && data.schema !== schemaPin) ||
          (upstreamSchema !== null && data.schema !== upstreamSchema)
        )
          throw new Failure('RESPONSE_IDENTITY');
        upstreamVersion = data.version;
        upstreamSchema = data.schema;
        const results = items ? data.results : data.rows;
        if (!Array.isArray(results) || results.length > 500)
          throw new Failure('ROW_LIMIT');
        budget.rows += results.length;
        if (budget.rows > 5000) throw new Failure('ROW_LIMIT');
        for (const raw of results) {
          const row = stains
            ? normalizeStainRow(raw, languages)
            : normalizeRow(raw, languages, items);
          if (
            !row ||
            !associated(row, selection) ||
            (!items && !wanted.includes(row.rowId))
          ) {
            complete = false;
            diagnostics.add('INVALID_ROW', [], 'An upstream row was rejected.');
            continue;
          }
          const old = rows.get(row.rowId);
          if (old && JSON.stringify(old) !== JSON.stringify(row)) {
            complete = false;
            diagnostics.add(
              'CONFLICTING_ROW',
              [],
              'Conflicting upstream rows were received.',
            );
          } else rows.set(row.rowId, row);
        }
        if (stains && data.next !== null && data.next !== undefined)
          throw new Failure('UNEXPECTED_PAGINATION');
        if (!items || data.next === null || data.next === undefined) break;
        if (
          typeof data.next !== 'string' ||
          data.next.length < 1 ||
          data.next.length > 2048
        )
          throw new Failure('INVALID_CURSOR');
        if (cursors.has(data.next)) throw new Failure('REPEATED_CURSOR');
        cursors.add(data.next);
        cursor = data.next;
        if (page + 1 >= maxPages) throw new Failure('PAGE_LIMIT');
      }
      const resultRows = [...rows.values()].sort((a, b) => a.rowId - b.rowId);
      if (
        complete &&
        cache &&
        !budget.cacheDown &&
        canonicalVersion(upstreamVersion) &&
        canonicalSchema(upstreamSchema)
      ) {
        const namespace = keyFor(upstreamVersion, upstreamSchema);
        const value: CachedRows = {
          format: 1,
          namespace,
          version: upstreamVersion,
          schema: upstreamSchema,
          complete: true,
          rows: resultRows,
        };
        // The result is complete before this write starts, so the write is best effort: a host
        // cache that rejects, hangs or outlives the deadline must not lower the status.
        try {
          const text = admittedJson(value);
          if (text !== null)
            await cacheCall(
              cache.set(
                namespace,
                JSON.parse(text) as CachedRows,
                resultRows.length ? 7 * 86400_000 : 600_000,
              ),
              signal,
              timeoutMs,
            );
        } catch (error) {
          // ignored on purpose, but a timeout stops further cache calls in this operation
          if (error instanceof Failure && error.code === 'CACHE_TIMEOUT')
            budget.cacheDown = true;
        }
      }
      if (upstreamVersion && upstreamSchema && complete) {
        if (schemas.size >= 128)
          schemas.delete(schemas.keys().next().value ?? '');
        schemas.set(upstreamVersion, {
          schema: upstreamSchema,
          expires: Date.now() + 600_000,
        });
      }
    } catch (error) {
      complete = false;
      const code = error instanceof Failure ? error.code : 'NETWORK_ERROR';
      diagnostics.add(
        code,
        [],
        stains
          ? 'Dye-name lookup could not complete.'
          : 'Equipment lookup could not complete.',
      );
      if (code === 'CANCELLED')
        return {
          ...failureResult(code, true),
          version: upstreamVersion,
          schema: upstreamSchema,
        };
    }
    return {
      status: complete ? 'complete' : rows.size ? 'partial' : 'unavailable',
      rows: [...rows.values()].sort((a, b) => a.rowId - b.rowId),
      version: upstreamVersion,
      schema: upstreamSchema,
      issues: diagnostics.issues,
    };
  }

  function pump(): void {
    while (active < 2 && queue.length) {
      const job = queue.shift();
      if (!job || job.controller.signal.aborted) continue;
      if (job.expires <= Date.now()) {
        job.controller.abort(new Failure('DEADLINE'));
        continue;
      }
      active++;
      job.started = true;
      void job
        .run()
        .then(job.finish, () => job.finish(job.failure('NETWORK_ERROR')))
        .finally(() => {
          active--;
          pump();
        });
    }
  }
  function subscribe<T>(
    key: string,
    run: (signal: AbortSignal) => Promise<T>,
    failure: (code: string, cancelled?: boolean) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(failure('CANCELLED', true));
    let job = jobs.get(key);
    if (job?.controller.signal.aborted) job = undefined;
    if (!job) {
      if (active >= 2 && queue.length >= 16)
        return Promise.resolve(failure('QUEUE_FULL'));
      const controller = new AbortController();
      let settle: (r: unknown) => void = () => {};
      const promise = new Promise<unknown>((resolve) => {
        settle = resolve;
      });
      const timer = setTimeout(
        () => controller.abort(new Failure('DEADLINE')),
        30_000,
      );
      const current: Job = {
        controller,
        promise,
        subscribers: 0,
        started: false,
        expires: Date.now() + 30_000,
        run: () => run(controller.signal),
        failure,
        finish: (result) => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', abort);
          if (jobs.get(key) === current) jobs.delete(key);
          settle(result);
        },
      };
      const abort = () => {
        const index = queue.indexOf(current);
        if (index >= 0) queue.splice(index, 1);
        if (!current.started)
          current.finish(
            failure(
              reason(controller.signal).code,
              reason(controller.signal).code === 'CANCELLED',
            ),
          );
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      job = current;
      jobs.set(key, job);
      queue.push(job);
      pump();
    }
    const shared = job;
    shared.subscribers++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (result: unknown) => {
        if (done) return;
        done = true;
        // Account first: a host signal whose methods throw must not skip the bookkeeping.
        if (--shared.subscribers === 0)
          shared.controller.abort(new Failure('CANCELLED'));
        try {
          signal?.removeEventListener('abort', abort);
        } catch {
          // a host signal; nothing more to release
        }
        resolve(JSON.parse(JSON.stringify(result)) as T);
      };
      const abort = () => finish(failure('CANCELLED', true));
      try {
        signal?.addEventListener('abort', abort, { once: true });
      } catch {
        // The signal cannot cancel this call, so it cannot be used: release the subscriber so the
        // shared request does not outlive its real callers.
        done = true;
        if (--shared.subscribers === 0)
          shared.controller.abort(new Failure('CANCELLED'));
        reject(new XivapiInputError('INVALID_LOOKUP'));
        return;
      }
      void shared.promise.then(finish);
    });
  }
  return {
    async getStains(ids, requestOptions = {}) {
      const signal = signalFrom(requestOptions);
      const stains = stainsFrom(ids);
      if (!stains.length)
        return {
          status: 'complete',
          rows: [],
          version: null,
          schema: null,
          issues: [],
        };
      const failure = (
        code: string,
        cancelled = false,
      ): LookupResult<StainRow> => ({
        ...failureResult(code, cancelled),
        issues: [
          {
            code,
            severity: 'warning',
            path: [],
            message: 'Dye-name lookup could not complete.',
          },
        ],
      });
      return (await subscribe(
        JSON.stringify(['stains', stains]),
        (signal) => lookup({ stains }, newBudget(signal)),
        failure,
        signal,
      )) as LookupResult<StainRow>;
    },
    async searchItems(models, requestOptions = {}) {
      const signal = signalFrom(requestOptions);
      const selection = lookupsFrom(models);
      if (!selection.length)
        return {
          status: 'complete',
          rows: [],
          version: null,
          schema: null,
          issues: [],
        };
      return (await subscribe(
        JSON.stringify(['items', selection]),
        (signal) => lookup(selection, newBudget(signal)),
        failureResult,
        signal,
      )) as LookupResult<ItemRow>;
    },
    async getGlasses(id, requestOptions = {}) {
      const signal = signalFrom(requestOptions);
      if (
        typeof id !== 'number' ||
        !Number.isInteger(id) ||
        id < 0 ||
        id > 65535
      )
        throw new XivapiInputError('INVALID_LOOKUP');
      return (await subscribe(
        JSON.stringify(['glasses', id]),
        (signal) => lookup(id, newBudget(signal)),
        failureResult,
        signal,
      )) as LookupResult<GlassesRow>;
    },
    async resolveRows(models, glassesId, signal) {
      const selection = lookupsFrom(models);
      if (!selection.length && glassesId === undefined)
        return { items: null, facewear: null };
      const failure = (code: string, cancelled = false): ResolvedRows => ({
        items: selection.length
          ? (failureResult(code, cancelled) as LookupResult<ItemRow>)
          : null,
        facewear:
          glassesId !== undefined
            ? (failureResult(code, cancelled) as LookupResult<GlassesRow>)
            : null,
      });
      return subscribe(
        JSON.stringify(['resolve', selection, glassesId ?? null]),
        async (sharedSignal) => {
          const budget = newBudget(sharedSignal);
          // Sequential components keep the instance's two-request concurrency bound.
          const items = selection.length
            ? ((await lookup(selection, budget)) as LookupResult<ItemRow>)
            : null;
          const facewear =
            glassesId !== undefined
              ? ((await lookup(glassesId, budget)) as LookupResult<GlassesRow>)
              : null;
          return { items, facewear };
        },
        failure,
        signal,
      );
    },
  };
}

export function createXivapiClient(options: XivapiOptions = {}): XivapiClient {
  const { searchItems, getGlasses, getStains } = createTransport(options);
  return { searchItems, getGlasses, getStains };
}
