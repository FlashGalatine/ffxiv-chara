import {
  test as base,
  expect,
  type JSHandle,
  type Page,
} from '@playwright/test';

export { expect };
export const XIVAPI = 'https://v2.xivapi.com';
/** Strings the e2e files put in private data; none may ever reach a request, a log or an event. */
export const PRIVATE = /canary_|private_/i;

export interface Recorded {
  url: string;
  method: string;
  origin: string;
  headers: Record<string, string>;
  postData: string | null;
}

type Forbidden = { __forbidden?: string[] };

/**
 * Everything the page did that could carry character data out, recorded from before the first
 * navigation: the fixture attaches it when the page is created, ahead of any beforeEach hook.
 *
 * Limits, so that the gates are not read as more than they are: a request body that is a Blob,
 * File or FormData reaches Playwright without its bytes, so any request that is not a GET is a
 * failure whatever its body; what a document sends while it is destroyed is not reported, so
 * the lifecycle events are fired on the live page instead; a violation of the Content-Security-Policy raised inside a dedicated
 * worker is not reported to the page (the worker's requests and console output are); and
 * SharedWorker, EventSource and the page's own WebSocket are refused outright.
 */
export class Traffic {
  requests: Recorded[] = [];
  console: string[] = [];
  pageErrors: string[] = [];
  dialogs: string[] = [];
  navigations: string[] = [];
  popups: string[] = [];
  downloads: string[] = [];
  websockets: string[] = [];
  /** Constructors the demo does not use that the page tried to call. */
  forbidden: string[] = [];
  blocksXivapi = true;
  private pending: Promise<unknown>[] = [];
  private finished = false;
  constructor(
    readonly appOrigin: string,
    private readonly page: Page,
  ) {}
  track(work: Promise<unknown>): void {
    this.pending.push(work.catch(() => {}));
  }
  /** Waits for the asynchronous reads (headers, console arguments) of everything seen so far. */
  async settle(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }
  /** Constructors the demo refuses that the page has tried to call, read from the live page. */
  async pullForbidden(): Promise<void> {
    if (this.page.isClosed()) return;
    try {
      const names = await this.page.evaluate(
        () => (window as unknown as Forbidden).__forbidden ?? [],
      );
      for (const name of names)
        if (!this.forbidden.includes(name)) this.forbidden.push(name);
    } catch {
      // The page has navigated or is going away: nothing more to read.
    }
  }
  /**
   * Ends the page's life while the listeners are still attached. Playwright does not report what a
   * document sends while it is being destroyed, so the events a page listens to on its way out
   * (visibilitychange, beforeunload, pagehide, unload, freeze) are fired on the live page, and a
   * short pause lets work that those handlers queue reach the network before anything is checked.
   */
  async finish(): Promise<void> {
    if (this.finished || this.page.isClosed()) return;
    this.finished = true;
    try {
      await this.pullForbidden();
      await this.page.evaluate(() => {
        for (const name of ['hidden', 'visibilityState'])
          Object.defineProperty(document, name, {
            configurable: true,
            get: () => (name === 'hidden' ? true : 'hidden'),
          });
        document.dispatchEvent(
          new Event('visibilitychange', { bubbles: true }),
        );
        window.dispatchEvent(new Event('beforeunload'));
        window.dispatchEvent(
          new PageTransitionEvent('pagehide', { persisted: false }),
        );
        window.dispatchEvent(new Event('unload'));
        document.dispatchEvent(new Event('freeze'));
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await this.pullForbidden();
      await this.page.goto('about:blank');
    } catch {
      // A page that is already gone has nothing more to send.
    }
    await this.settle();
  }
  /** Forgets everything recorded so far, including what the page has noted for itself. */
  async reset(): Promise<void> {
    this.requests = [];
    this.console = [];
    this.pageErrors = [];
    this.dialogs = [];
    this.navigations = [];
    this.popups = [];
    this.downloads = [];
    this.websockets = [];
    this.forbidden = [];
    this.finished = false;
    if (!this.page.isClosed())
      await this.page
        .evaluate(() => {
          const list = (window as unknown as Forbidden).__forbidden;
          if (list) list.length = 0;
        })
        .catch(() => {});
  }
  /** Requests to anything but the page's own origin. */
  offOrigin(): Recorded[] {
    return this.requests.filter((r) => r.origin !== this.appOrigin);
  }
  sameOrigin(): Recorded[] {
    return this.requests.filter((r) => r.origin === this.appOrigin);
  }
  toXivapi(): Recorded[] {
    return this.requests.filter((r) => r.origin === XIVAPI);
  }
  /** Requests that can carry a body, whose content Playwright may not be able to read. */
  nonGet(): Recorded[] {
    return this.requests.filter(
      (r) => r.method !== 'GET' && r.method !== 'HEAD',
    );
  }
  /** Messages the browser logged about the page's Content-Security-Policy blocking something. */
  cspViolations(): string[] {
    return this.console.filter((text) => /Content Security Policy/i.test(text));
  }
  /** Where `pattern` appears in what was recorded: URL, header, body, console text or argument. */
  async leaks(pattern: RegExp): Promise<string[]> {
    await this.pullForbidden();
    await this.settle();
    const found: string[] = [];
    for (const r of this.requests) {
      const parts: [string, string][] = [
        ['url', r.url],
        ['body', r.postData ?? ''],
        ...Object.entries(r.headers).map(([name, value]): [string, string] => [
          `header ${name}`,
          value,
        ]),
      ];
      for (const [part, text] of parts)
        if (pattern.test(text))
          found.push(`request ${part}: ${r.method} ${r.url}`);
    }
    const events: [string, string[]][] = [
      ['console', this.console],
      ['page error', this.pageErrors],
      ['dialog', this.dialogs],
      ['navigation', this.navigations],
      ['popup', this.popups],
      ['download', this.downloads],
      ['websocket', this.websockets],
      ['forbidden constructor', this.forbidden],
    ];
    for (const [kind, list] of events)
      for (const text of list)
        if (pattern.test(text)) found.push(`${kind}: ${text}`);
    return found;
  }
}

/**
 * Serialises a console argument inside the page that logged it. Playwright's own JSON form shows
 * a File, an Event, a Map, a Set and a DOM node as empty or as a type name, and gives up on a
 * cycle, so the content a developer would see in the console never reached the scan.
 */
function describeInPage(root: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'function') return `[function ${value.name}]`;
    if (typeof value !== 'object')
      return typeof value === 'bigint' || typeof value === 'symbol'
        ? String(value)
        : value;
    if (depth > 8) return '[depth]';
    const object = value as object;
    if (seen.has(object)) return '[circular]';
    seen.add(object);
    if (object instanceof Error)
      return {
        error: object.name,
        message: object.message,
        stack: object.stack,
        cause: walk((object as { cause?: unknown }).cause, depth + 1),
      };
    if (object instanceof Map)
      return {
        map: [...object].map(([k, v]) => [
          walk(k, depth + 1),
          walk(v, depth + 1),
        ]),
      };
    if (object instanceof Set)
      return { set: [...object].map((v) => walk(v, depth + 1)) };
    if (typeof Node !== 'undefined' && object instanceof Node)
      return { node: (object as Element).outerHTML ?? object.textContent };
    if (object instanceof ArrayBuffer)
      return { bytes: new TextDecoder().decode(object) };
    if (ArrayBuffer.isView(object))
      return {
        bytes: new TextDecoder().decode(
          new Uint8Array(object.buffer, object.byteOffset, object.byteLength),
        ),
      };
    if (Array.isArray(object)) return object.map((v) => walk(v, depth + 1));
    const out: Record<string, unknown> = {};
    if (object instanceof Blob)
      out.blob = {
        type: object.type,
        size: object.size,
        name: (object as { name?: string }).name,
      };
    if (object instanceof Event) out.event = object.type;
    // Own and inherited properties, enumerable or not: an Event keeps its data on the prototype.
    const names = new Set<string>();
    for (
      let proto: object | null = object;
      proto && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto)
    )
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
    for (const name of names) {
      if (name === 'constructor') continue;
      try {
        const property = (object as Record<string, unknown>)[name];
        if (typeof property !== 'function')
          out[name] = walk(property, depth + 1);
      } catch {
        // A getter that throws (or needs a receiver) is skipped.
      }
    }
    return out;
  };
  try {
    return JSON.stringify(walk(root, 0));
  } catch {
    return String(root);
  }
}
async function describe(argument: JSHandle): Promise<string> {
  try {
    return await argument.evaluate(describeInPage);
  } catch {
    return String(argument);
  }
}
function record(page: Page, appOrigin: string): Traffic {
  const traffic = new Traffic(appOrigin, page);
  page.on('request', (request) => {
    const entry: Recorded = {
      url: request.url(),
      method: request.method(),
      origin: new URL(request.url()).origin,
      headers: {},
      postData: request.postData(),
    };
    traffic.requests.push(entry);
    traffic.track(
      request.allHeaders().then((headers) => {
        entry.headers = headers;
      }),
    );
  });
  page.on('console', (message) => {
    const index = traffic.console.length;
    traffic.console.push(message.text());
    traffic.track(
      Promise.all(message.args().map(describe)).then((parts) => {
        traffic.console[index] =
          `${message.type()}: ${message.text()} ${parts.join(' ')}`;
      }),
    );
  });
  page.on('pageerror', (error) =>
    traffic.pageErrors.push(
      `${error.name}: ${error.message}\n${error.stack ?? ''}`,
    ),
  );
  page.on('dialog', (dialog) => {
    traffic.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) traffic.navigations.push(frame.url());
  });
  page.on('popup', (popup) => traffic.popups.push(popup.url()));
  page.on('download', (download) => traffic.downloads.push(download.url()));
  // WebSockets are not requests to Playwright; the page and its dedicated workers report them here.
  page.on('websocket', (socket) => {
    traffic.websockets.push(socket.url());
    socket.on('framesent', (frame) =>
      traffic.websockets.push(`${socket.url()} sent ${String(frame.payload)}`),
    );
  });
  return traffic;
}

const recorded = new WeakMap<Page, Traffic>();
export const test = base.extend<{ traffic: Traffic; allowXivapi: boolean }>({
  // Set by the one test that talks to the real service (live.spec.ts).
  allowXivapi: [false, { option: true }],
  // Overriding `page` guarantees the recorder exists before any hook or test body navigates.
  page: async ({ page, baseURL, allowXivapi }, use) => {
    const traffic = record(page, new URL(baseURL ?? 'http://127.0.0.1').origin);
    recorded.set(page, traffic);
    // Nothing reaches the real XIVAPI by accident: a test that wants a mock installs its own
    // route, which takes precedence over this one.
    traffic.blocksXivapi = !allowXivapi;
    if (!allowXivapi)
      await page
        .context()
        .route(`${XIVAPI}/**`, (route) => route.abort('blockedbyclient'));
    // The demo uses none of these, so any use is a failure. They are replaced on the page; a
    // dedicated worker is still covered by the websocket and request events.
    await page.addInitScript(() => {
      const forbidden: string[] = [];
      (window as unknown as Forbidden).__forbidden = forbidden;
      for (const name of ['SharedWorker', 'EventSource', 'WebSocket']) {
        const target = window as unknown as Record<string, unknown>;
        if (!target[name]) continue;
        target[name] = function refused(...args: unknown[]) {
          forbidden.push(`${name}(${args.map(String).join(', ')})`);
          throw new Error(`${name} is not used by the demo`);
        };
      }
    });
    await use(page);
    await traffic.finish();
    expect(
      await traffic.leaks(PRIVATE),
      'private data reached a request, log or event',
    ).toEqual([]);
    expect(traffic.pageErrors, 'uncaught page errors').toEqual([]);
    expect(traffic.cspViolations(), 'CSP violations').toEqual([]);
    expect(traffic.dialogs, 'dialogs').toEqual([]);
    expect(traffic.popups, 'popups').toEqual([]);
    expect(traffic.downloads, 'downloads').toEqual([]);
    expect(traffic.websockets, 'WebSockets').toEqual([]);
    expect(traffic.forbidden, 'constructors the demo does not use').toEqual([]);
    expect(
      traffic.nonGet().map((r) => `${r.method} ${r.url}`),
      'requests that are not GET',
    ).toEqual([]);
    expect(
      [...new Set(traffic.offOrigin().map((r) => r.origin))].filter(
        (origin) => origin !== XIVAPI,
      ),
      'requests to origins the page may not use',
    ).toEqual([]);
  },
  traffic: async ({ page }, use) => {
    const traffic = recorded.get(page);
    if (!traffic)
      throw new Error('The page fixture did not attach a recorder.');
    await use(traffic);
  },
});
