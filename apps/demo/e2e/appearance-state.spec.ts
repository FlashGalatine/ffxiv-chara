import { expect, test } from './fixtures.js';
import { load, resolveButton } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows the retained file’s colors after a replacement is rejected while they load', async ({
  page,
}) => {
  let held = false;
  let release: (() => void) | undefined;
  await page.route('**/assets/palettes-*.js', async (route) => {
    if (held) {
      await route.continue();
      return;
    }
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort('failed').catch(() => {});
  });
  await page.getByRole('button', { name: 'Anamnesis', exact: true }).click();
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByTestId('swatches')).toContainText('Loading');
  await load(page, {}, 'replacement.pose');
  await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByTestId('swatches')).not.toContainText('Loading');
  await expect(page.getByTestId('swatch-rightEye')).toContainText('#F7F7F7');
  await expect(page.locator('.filename')).toHaveText('anamnesis.chara');
  await expect(page.locator('.local-status')).toHaveText(
    'File rejected or processing incomplete.',
  );
  release?.();
});

test('reports the retained file’s colors as unavailable when resuming them fails too', async ({
  page,
}) => {
  let held = false;
  let release: (() => void) | undefined;
  await page.route('**/assets/palettes-*.js', async (route) => {
    if (held) {
      await route.abort('failed');
      return;
    }
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort('failed').catch(() => {});
  });
  await page.getByRole('button', { name: 'Anamnesis', exact: true }).click();
  await expect(page.getByTestId('swatches')).toContainText('Loading');
  await load(page, {}, 'replacement.pose');
  await expect(page.getByRole('alert')).toContainText('APPEARANCE_UNAVAILABLE');
  // The rejection of the file the user chose stays visible next to the colors failure.
  await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
  await expect(page.getByRole('alert')).not.toContainText(
    'selected file remains',
  );
  await expect(page.locator('.local-status')).toContainText('File rejected');
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByTestId('swatches')).not.toContainText('Loading');
  await expect(page.getByTestId('swatch-hair')).toContainText('Unavailable');
  await expect(resolveButton(page)).toBeEnabled();
  // The colors sentence is about the previous file, and no size note belongs to this refusal.
  await expect(page.getByRole('alert')).toHaveText(
    /retained\. APPEARANCE_UNAVAILABLE: The previous file's colors could not be resolved\.$/,
  );
  release?.();
});

test('keeps the size note when a file over the limit was refused and resuming the retained colors fails too', async ({
  page,
}) => {
  let held = false;
  let release: (() => void) | undefined;
  await page.route('**/assets/palettes-*.js', async (route) => {
    if (held) {
      await route.abort('failed');
      return;
    }
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort('failed').catch(() => {});
  });
  await page.getByRole('button', { name: 'Anamnesis', exact: true }).click();
  await expect(page.getByTestId('swatches')).toContainText('Loading');
  const MIB8 = 8 * 1024 * 1024;
  const text = '{"Tribe":"Xaela"}';
  await load(page, text + ' '.repeat(MIB8 + 1 - text.length), 'over.chara');
  await expect(page.getByRole('alert')).toContainText('APPEARANCE_UNAVAILABLE');
  // The rejection of the file the user chose stays visible, with the reason, and the sentence about
  // the colors comes before the note, so that "previous file" is what it refers to.
  await expect(page.getByRole('alert')).toHaveText(
    /^FILE_TOO_LARGE: .*retained\. APPEARANCE_UNAVAILABLE: The previous file's colors could not be resolved\. The demo reads files up to 8 MiB\. .*embedded image/,
  );
  await expect(page.getByRole('alert')).not.toContainText(
    'selected file remains',
  );
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByTestId('swatch-hair')).toContainText('Unavailable');
  await expect(resolveButton(page)).toBeEnabled();
  release?.();
});

test('posts the appearance result without the stored subtrees the inspection already carries', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    const messages: string[] = [];
    (window as typeof window & { __messages: string[] }).__messages = messages;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Native>) {
        super(...args);
        this.addEventListener('message', (event) =>
          messages.push(JSON.stringify(event.data)),
        );
      }
    };
  });
  await page.goto('/');
  await load(page, {
    Tribe: 'Midlander',
    HairTone: { bulk: 'SUBTREE_MARK' },
    HairColor: { R: 0.1, G: 0.2, B: 0.3, Extra: 'EXTENDED_MARK' },
  });
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByTestId('swatches')).not.toContainText('Loading');
  const messages = await page.evaluate(
    () => (window as typeof window & { __messages: string[] }).__messages,
  );
  const inspection = messages.find((m) => m.includes('"type":"inspection"'));
  const appearance = messages.find((m) => m.includes('"type":"appearance"'));
  expect(inspection).toContain('SUBTREE_MARK');
  expect(inspection).toContain('EXTENDED_MARK');
  expect(appearance).toBeDefined();
  expect(appearance).not.toContain('SUBTREE_MARK');
  expect(appearance).not.toContain('EXTENDED_MARK');
});
