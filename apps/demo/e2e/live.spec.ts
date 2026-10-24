import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';

// The one test that reaches the real XIVAPI: the default block is for every other test.
test.use({ allowXivapi: true });

test('manual live browser lookup', async ({ page }) => {
  test.skip(
    process.env.CHARA_LIVE_SMOKE !== '1',
    'Opt-in ordinary integration check; automated suites never contact production.',
  );
  test.setTimeout(60_000);
  const requests: {
    url: string;
    method: string;
    body: string | null;
    cookie: boolean;
    authorization: boolean;
    referrer: boolean;
  }[] = [];
  const responses: {
    status: number;
    path: string;
    cors: string | undefined;
  }[] = [];
  page.on('request', async (request) => {
    if (!request.url().startsWith('https://v2.xivapi.com/')) return;
    const headers = await request.allHeaders();
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      cookie: Boolean(headers.cookie),
      authorization: Boolean(headers.authorization),
      referrer: Boolean(headers.referer),
    });
  });
  page.on('response', (response) => {
    if (response.url().startsWith('https://v2.xivapi.com/'))
      responses.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
        cors: response.headers()['access-control-allow-origin'],
      });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ktisis', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Resolve equipment and dye names',
      exact: true,
    }),
  ).toBeEnabled();
  expect(requests).toEqual([]);
  await page
    .getByRole('button', {
      name: 'Resolve equipment and dye names',
      exact: true,
    })
    .click();
  await expect(page.getByTestId('lookup-evidence')).toContainText(
    /[a-f0-9]{16}/,
    { timeout: 35_000 },
  );
  await expect(page.locator('.item-icon img')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect
    .poll(() =>
      page
        .locator('.item-icon img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  for (const request of requests) {
    expect(request.method).toBe('GET');
    expect(request.body).toBeNull();
    expect(request.cookie || request.authorization || request.referrer).toBe(
      false,
    );
    const url = new URL(request.url);
    expect([
      '/api/version',
      '/api/search',
      '/api/sheet/Glasses',
      '/api/asset',
    ]).toContain(url.pathname);
    expect(
      [...url.searchParams.keys()].every((key) =>
        [
          'fields',
          'version',
          'schema',
          'language',
          'transient',
          'limit',
          'sheets',
          'query',
          'cursor',
          'rows',
          'path',
          'format',
        ].includes(key),
      ),
    ).toBe(true);
    if (url.pathname === '/api/search')
      expect(url.searchParams.get('query')).toBe(
        '+((+EquipSlotCategory.Body=1 +ModelMain=328041))',
      );
    if (url.pathname === '/api/sheet/Glasses')
      expect(url.searchParams.get('rows')).toBe('12');
  }
  const iconEvidence = await page
    .locator('.item-icon img')
    .evaluateAll((images) =>
      images.map((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
        localBlob: image.getAttribute('src')?.startsWith('blob:'),
      })),
    );
  const evidence = {
    requests,
    responses,
    upstream: await page.getByTestId('lookup-evidence').textContent(),
    icons: iconEvidence,
  };
  if (process.env.DEMO_QA_DIR) {
    await writeFile(
      `${process.env.DEMO_QA_DIR}/demo-live.json`,
      JSON.stringify(evidence, null, 2),
    );
    await page.screenshot({
      path: `${process.env.DEMO_QA_DIR}/demo-live.png`,
      fullPage: true,
    });
  }
});
