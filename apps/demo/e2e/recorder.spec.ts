import { expect, test } from './fixtures.js';

// Without these, "nothing leaked" could mean "nothing was being watched". Each case sends a marker
// by a route the recorder claims to cover and checks that the recorder reports it. The fixture's
// own end-of-test gates are cleared with traffic.reset() once the detection has been shown.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const MARKER = /CONTROL_/;
const found = async (traffic: { leaks(pattern: RegExp): Promise<string[]> }) =>
  (await traffic.leaks(MARKER)).join('\n');

test('sees a marker in a URL, header, body, nested console argument, page error, dialog and navigation', async ({
  page,
  traffic,
}) => {
  await page.evaluate(() => {
    void fetch('/control?CONTROL_URL', {
      method: 'POST',
      headers: { 'x-control': 'CONTROL_HEADER' },
      body: 'CONTROL_BODY',
    }).catch(() => {});
    console.log({ nested: { deep: ['CONTROL_CONSOLE'] } });
    setTimeout(() => {
      throw new Error('CONTROL_ERROR');
    }, 0);
    location.hash = 'CONTROL_NAVIGATION';
    alert('CONTROL_DIALOG');
  });
  await expect
    .poll(async () => (await traffic.leaks(MARKER)).length)
    .toBeGreaterThanOrEqual(7);
  const text = await found(traffic);
  for (const where of [
    'request url',
    'request header',
    'request body',
    'console',
    'page error',
    'dialog',
    'navigation',
  ])
    expect(text, where).toContain(where);
  await traffic.reset();
});

// Playwright may not be able to read a Blob or File body (it can only when it intercepts the request),
// so the method is what gives the request away. Both modes are run.
for (const [name, allowXivapi] of [
  ['with request interception', false],
  ['without request interception', true],
] as const)
  test.describe(name, () => {
    test.use({ allowXivapi });
    test('flags a request that carries a Blob or File, because it is not a GET', async ({
      page,
      traffic,
    }) => {
      await page.evaluate(() => {
        void fetch('/control-blob', {
          method: 'POST',
          body: new Blob(['CONTROL_BLOB']),
        }).catch(() => {});
        void fetch('/control-file', {
          method: 'PUT',
          body: new File(['CONTROL_FILE'], 'CONTROL_FILE_NAME.chara'),
        }).catch(() => {});
      });
      await expect.poll(() => traffic.nonGet().length).toBe(2);
      expect(
        traffic
          .nonGet()
          .map((r) => r.method)
          .sort(),
      ).toEqual(['POST', 'PUT']);
      await traffic.reset();
    });
  });

test('sees what a page sends as it goes away', async ({ page, traffic }) => {
  await page.evaluate(() => {
    for (const name of ['pagehide', 'unload', 'beforeunload'])
      addEventListener(name, () => {
        navigator.sendBeacon(
          `/control-${name}?CONTROL_${name.toUpperCase()}`,
          'CONTROL_BEACON',
        );
      });
    document.addEventListener('visibilitychange', () => {
      navigator.sendBeacon(
        '/control-visibility?CONTROL_VISIBILITY',
        'CONTROL_BEACON',
      );
    });
    document.addEventListener('freeze', () => {
      void fetch('/control-freeze?CONTROL_FREEZE', {
        method: 'POST',
        keepalive: true,
      });
    });
  });
  await traffic.finish();
  const text = await found(traffic);
  for (const marker of [
    'CONTROL_PAGEHIDE',
    'CONTROL_UNLOAD',
    'CONTROL_BEFOREUNLOAD',
    'CONTROL_VISIBILITY',
    'CONTROL_FREEZE',
  ])
    expect(text, marker).toContain(marker);
  await traffic.reset();
});

test('sees a WebSocket opened by the page or by a worker, and refuses SharedWorker and EventSource', async ({
  page,
  traffic,
}) => {
  await page.route('**/control-worker.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "try { new WebSocket('ws://' + location.host + '/CONTROL_WS_WORKER'); } catch {}",
    }),
  );
  await page.evaluate(() => {
    for (const make of [
      () => new WebSocket(`ws://${location.host}/CONTROL_WS_PAGE`),
      () => new SharedWorker('/control-shared.js?CONTROL_SHARED'),
      () => new EventSource('/control-events?CONTROL_EVENTS'),
    ])
      try {
        make();
      } catch {}
    new Worker('/control-worker.js');
  });
  await expect
    .poll(async () => (await traffic.leaks(MARKER)).length)
    .toBeGreaterThanOrEqual(4);
  const text = await found(traffic);
  // The page's own constructors are refused outright, not merely observed: a SharedWorker's
  // traffic is invisible to Playwright, so the call itself is what is reported.
  for (const name of ['SharedWorker', 'EventSource', 'WebSocket'])
    expect(text, name).toContain(`forbidden constructor: ${name}(`);
  for (const marker of [
    'CONTROL_WS_PAGE',
    'CONTROL_WS_WORKER',
    'CONTROL_SHARED',
    'CONTROL_EVENTS',
  ])
    expect(text, marker).toContain(marker);
  await traffic.reset();
});

test('reads console arguments that JSON would show as empty', async ({
  page,
  traffic,
}) => {
  await page.route('**/control-logger.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "console.log(new Map([['key', 'CONTROL_WORKER_MAP']]));",
    }),
  );
  await page.evaluate(() => {
    const cyclic: Record<string, unknown> = { name: 'CONTROL_CYCLE' };
    cyclic.self = cyclic;
    const element = document.createElement('p');
    element.textContent = 'CONTROL_NODE';
    console.log(new Map([['key', 'CONTROL_MAP']]));
    console.log(new Set(['CONTROL_SET']));
    console.log(new File(['x'], 'CONTROL_FILE.chara'));
    console.log(cyclic);
    console.log(element);
    console.log(new Error('CONTROL_ERROR_MESSAGE'));
    console.log(
      new MessageEvent('message', { data: { doc: 'CONTROL_EVENT' } }),
    );
    console.log([[['CONTROL_DEEP']]]);
    console.log(Object.create({ inherited: 'CONTROL_INHERITED' }));
    new Worker('/control-logger.js');
  });
  const markers = [
    'CONTROL_MAP',
    'CONTROL_SET',
    'CONTROL_FILE',
    'CONTROL_CYCLE',
    'CONTROL_NODE',
    'CONTROL_ERROR_MESSAGE',
    'CONTROL_EVENT',
    'CONTROL_DEEP',
    'CONTROL_INHERITED',
    'CONTROL_WORKER_MAP',
  ];
  await expect
    .poll(async () => {
      const text = await found(traffic);
      return markers.filter((marker) => !text.includes(marker));
    })
    .toEqual([]);
  await traffic.reset();
});

test('sees the page’s own Content-Security-Policy block something', async ({
  page,
  traffic,
}) => {
  await page.evaluate(() => {
    const image = new Image();
    image.src = 'https://v2.xivapi.com/control.png';
    document.body.append(image);
  });
  await expect.poll(() => traffic.cspViolations().length).toBeGreaterThan(0);
  await traffic.reset();
});

test('blocks XIVAPI unless a test opts in', async ({ traffic }) => {
  expect(traffic.blocksXivapi).toBe(true);
});
test.describe('a test that opts in', () => {
  test.use({ allowXivapi: true });
  test('does not get the default block', async ({ traffic }) => {
    expect(traffic.blocksXivapi).toBe(false);
  });
});
