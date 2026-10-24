import { expect, test } from './fixtures.js';
import { load, resolveButton } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
for (const [producer, race] of [
  ['Anamnesis', 'Hyur'],
  ['Ktisis', 'Lalafell'],
  ['Brio', 'Au Ra'],
] as const)
  test(`locally inspects ${producer}`, async ({ page }) => {
    const external: string[] = [];
    const origin = new URL(page.url()).origin;
    page.on('request', (r) => {
      if (new URL(r.url()).origin !== origin) external.push(r.url());
    });
    await page.getByRole('button', { name: producer, exact: true }).click();
    await expect(page.getByTestId('identity')).toContainText(race ?? '');
    await expect(
      page.getByRole('heading', { name: 'Appearance', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('swatches').locator('canvas')).toHaveCount(8);
    if (producer === 'Anamnesis') {
      await expect(page.getByTestId('swatch-rightEye')).toContainText(
        '#F7F7F7',
      );
      expect(
        await page
          .getByTestId('swatch-rightEye')
          .locator('canvas')
          .evaluate((canvas) =>
            Array.from(
              (canvas as HTMLCanvasElement)
                .getContext('2d')
                ?.getImageData(0, 0, 1, 1).data ?? [],
            ),
          ),
      ).toEqual([247, 247, 247, 255]);
      if (process.env.DEMO_QA_DIR)
        await page.screenshot({
          path: `${process.env.DEMO_QA_DIR}/demo-desktop.png`,
          fullPage: true,
        });
    }
    expect(external).toEqual([]);
  });
test('supports partial equipment-only files and retains stored dye IDs', async ({
  page,
}) => {
  await load(page, {
    Body: { ModelBase: 361, ModelVariant: 5, DyeId: 0, DyeId2: 3 },
  });
  await expect(page.getByTestId('identity')).toContainText('Not stored');
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    '361 / 5',
  );
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    '1: No dye (0)',
  );
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    '2: Name not looked up (3)',
  );
  await page.getByText('Stored values', { exact: true }).click();
  await page.getByText('Body — Object', { exact: true }).click();
  await expect(page.getByTestId('stored-values')).toContainText('DyeId2');
});

test('retains both dye IDs locally and preserves missing, null and invalid values', async ({
  page,
}) => {
  const external: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) external.push(request.url());
  });
  await load(page, {
    Body: { ModelBase: 361, ModelVariant: 5, DyeId: 10, DyeId2: 101 },
    Hands: { ModelBase: 361, ModelVariant: 5, DyeId: 126, DyeId2: 65535 },
    Feet: { ModelBase: 361, ModelVariant: 5, DyeId: null },
    HeadGear: { ModelBase: 361, ModelVariant: 5, DyeId: '3', DyeId2: 0 },
  });
  const body = page.getByRole('row', { name: /Body/ });
  await expect(body).toContainText('1: Name not looked up (10)');
  await expect(body).toContainText('2: Name not looked up (101)');
  const hands = page.getByRole('row', { name: /Hands/ });
  await expect(hands).toContainText('1: Name not looked up (126)');
  await expect(hands).toContainText('2: Name not looked up (65535)');
  const feet = page.getByRole('row', { name: /Feet/ });
  await expect(feet).toContainText('1: null');
  await expect(feet).toContainText('2: Not stored');
  const head = page.getByRole('row', { name: /^Head/ });
  await expect(head).toContainText('1: Invalid');
  await expect(head).toContainText('2: No dye (0)');
  await page.getByText('Stored values', { exact: true }).click();
  await page.getByText('Body — Object', { exact: true }).click();
  for (const [key, value] of [
    ['DyeId', '10'],
    ['DyeId2', '101'],
  ]) {
    await expect(
      page
        .getByTestId('stored-values')
        .locator('.raw-entry')
        .filter({
          has: page.getByText(key ?? '', { exact: true }),
        })
        .locator(':scope > code'),
    ).toHaveText(value ?? '');
  }
  expect(external).toEqual([]);
});
test('renders hostile names and values literally, requests nothing and omits embedded image payloads', async ({
  page,
  traffic,
}) => {
  // The fixture also fails the test on any dialog, popup, download, page error or CSP violation.
  const hostileName = '<img src=x onerror=alert(6)>.chara';
  await load(
    page,
    {
      Nickname: '<img src="https://evil.invalid/" onerror="alert(1)">',
      HairTone: 0,
      Base64Image: 'PRIVATE_IMAGE_CANARY',
      Note: '<script>alert(1)</script>',
      '<img src=x onerror=alert(2)>': 'hostile key',
      '"><svg onload=alert(3)>': { '<b>nested</b>': 'javascript:alert(4)' },
      Link: 'javascript:alert(5)',
      Tracker: 'https://evil.invalid/tracker.png',
    },
    hostileName,
  );
  await expect(page.getByTestId('identity')).toContainText('<img src=');
  await expect(page.locator('.filename')).toHaveText(hostileName);
  await page.getByText('Stored values', { exact: true }).click();
  await expect(page.getByTestId('stored-values')).toContainText(
    '<script>alert(1)</script>',
  );
  await expect(page.getByTestId('stored-values')).toContainText(
    '<img src=x onerror=alert(2)>',
  );
  await page.getByText('"><svg onload=alert(3)> — Object').click();
  await expect(page.getByTestId('stored-values')).toContainText(
    'javascript:alert(4)',
  );
  await expect(page.getByTestId('swatches')).not.toContainText('Loading');
  expect(
    await page
      .locator('img[src*="evil"], svg[onload], script:not([src])')
      .count(),
  ).toBe(0);
  expect(await page.locator('body').textContent()).not.toContain(
    'PRIVATE_IMAGE_CANARY',
  );
  await traffic.settle();
  expect(traffic.offOrigin()).toEqual([]);
  expect(traffic.requests.filter((r) => /evil|alert/.test(r.url))).toEqual([]);
  expect(traffic.navigations).toEqual([`${traffic.appOrigin}/`]);
  expect(traffic.dialogs).toEqual([]);
  expect(traffic.pageErrors).toEqual([]);
});
test('preserves a valid inspection on rejected replacements and checks extension and size', async ({
  page,
}) => {
  await load(page, { Tribe: 'Midlander' });
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  for (const [content, name, reason] of [
    [{ Bone: {} }, 'renamed.chara', 'NOT_CHARACTER'],
    [{ Tribe: 'Xaela' }, 'test.pose', 'FILE_EXTENSION'],
    ['x'.repeat(8 * 1024 * 1024 + 1), 'big.chara', 'FILE_TOO_LARGE'],
  ]) {
    await load(page, content, String(name));
    await expect(page.getByRole('alert')).toContainText(String(reason));
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    // The file that is kept can be looked up again, whichever way the replacement was refused.
    await expect(resolveButton(page)).toBeEnabled();
  }
});
test('provides keyboard file selection and clear releases local state', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Choose .chara file', exact: true })
    .focus();
  const chooser = page.waitForEvent('filechooser');
  // A key press is immediate, unlike a click: make sure the browser is intercepting the chooser
  // before the press opens it, or the native dialog opens and no event ever arrives.
  await page.evaluate(() => undefined);
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({
    name: 'keyboard.chara',
    mimeType: 'application/json',
    buffer: Buffer.from('{"Tribe":"Xaela"}'),
  });
  await expect(page.getByTestId('identity')).toContainText('Au Ra');
  await page.getByRole('button', { name: 'Clear file', exact: true }).click();
  await expect(page.getByTestId('identity')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Resolve equipment' }),
  ).toHaveCount(0);
});
test('bounds stored-value batches and scalar previews', async ({ page }) => {
  await load(page, {
    HairTone: 0,
    ...Object.fromEntries(
      Array.from({ length: 250 }, (_, i) => [`extra${i}`, 'x'.repeat(2100)]),
    ),
  });
  await expect(page.getByTestId('identity')).toBeVisible();
  await page.getByText('Stored values', { exact: true }).click();
  await expect(
    page.getByTestId('stored-values').locator(':scope > .raw-entry'),
  ).toHaveCount(200);
  await expect(page.getByTestId('stored-values')).toContainText(
    'preview truncated',
  );
  await page.getByRole('button', { name: 'Show next 200 fields' }).click();
  await expect(
    page.getByTestId('stored-values').locator(':scope > .raw-entry'),
  ).toHaveCount(51);
  await page.getByRole('button', { name: 'Show previous 200 fields' }).click();
  await expect(
    page.getByTestId('stored-values').locator(':scope > .raw-entry'),
  ).toHaveCount(200);
  await expect(page.getByTestId('stored-values')).toContainText('HairTone');
});
test('reports failed appearance processing without a permanent loading state or false replacement claim', async ({
  page,
}) => {
  await page.route('**/assets/palettes-*.js', (route) => route.abort('failed'));
  await load(page, { Tribe: 'Midlander', HairTone: 0 });
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByRole('alert')).toContainText('APPEARANCE_UNAVAILABLE');
  await expect(page.getByRole('alert')).not.toContainText('previous valid');
  await expect(page.getByTestId('swatch-hair')).toContainText('Unavailable');
  await expect(page.getByTestId('swatches')).not.toContainText('Loading');
  // The file was inspected, so a lookup can still be started.
  await expect(resolveButton(page)).toBeEnabled();
});
test('shows only the first 256 characters of a file name', async ({ page }) => {
  await load(page, { Tribe: 'Midlander' }, `${'n'.repeat(300)}.chara`);
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.locator('.filename')).toHaveText('n'.repeat(256));
});
test('bounds the visible character nickname without changing its admitted value', async ({
  page,
}) => {
  await load(page, { Nickname: 'n'.repeat(6000), HairTone: 0 });
  await expect(page.getByTestId('identity')).toContainText('preview truncated');
  expect(
    (await page.getByTestId('identity').locator('h2').textContent())?.length,
  ).toBeLessThan(2100);
});
test('keeps JSON string, null, boolean and numeric evidence distinguishable', async ({
  page,
}) => {
  await load(page, {
    HairTone: 0,
    NullValue: null,
    NullText: 'null',
    Flag: false,
    FlagText: 'false',
    Number: 0,
    NumberText: '0',
    EmptyText: '',
  });
  await expect(page.getByTestId('identity')).toBeVisible();
  await page.getByText('Stored values', { exact: true }).click();
  for (const [key, expected] of [
    ['NullValue', 'null'],
    ['NullText', '"null"'],
    ['Flag', 'false'],
    ['FlagText', '"false"'],
    ['Number', '0'],
    ['NumberText', '"0"'],
    ['EmptyText', '""'],
  ]) {
    await expect(
      page
        .getByTestId('stored-values')
        .locator('.raw-entry')
        .filter({
          has: page.locator('.raw-key', { hasText: new RegExp(`^${key}$`) }),
        })
        .locator('code'),
    ).toHaveText(expected ?? '');
  }
});
test('works at a mobile viewport without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Anamnesis', exact: true }).click();
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (process.env.DEMO_QA_DIR)
    await page.screenshot({
      path: `${process.env.DEMO_QA_DIR}/demo-mobile.png`,
      fullPage: true,
    });
});
