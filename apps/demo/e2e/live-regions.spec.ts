import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { answerLookup, equipmentBody, load, resolveButton } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('live regions', () => {
  // Tags the persistent regions and records every live-region node inserted after this point.
  async function watch(page: Page) {
    await page.evaluate(() => {
      const w = window as typeof window & {
        __live: {
          status: Element | null;
          alert: Element | null;
          inserted: string[];
          alertChanges: number;
        };
      };
      const live = '[role="status"], [role="alert"], [aria-live]';
      const state = {
        status: document.querySelector('.local-status'),
        alert: document.querySelector('[role="alert"]'),
        inserted: [] as string[],
        alertChanges: 0,
      };
      w.__live = state;
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node instanceof Element)
              for (const match of [
                ...(node.matches(live) ? [node] : []),
                ...node.querySelectorAll(live),
              ])
                state.inserted.push(
                  `${match.getAttribute('role') ?? 'aria-live'}: ${match.textContent}`,
                );
      }).observe(document.body, { childList: true, subtree: true });
      if (state.alert)
        new MutationObserver((records) => {
          state.alertChanges += records.length;
        }).observe(state.alert, {
          childList: true,
          characterData: true,
          subtree: true,
        });
    });
  }
  const report = (page: Page) =>
    page.evaluate(() => {
      const w = window as typeof window & {
        __live: {
          status: Element | null;
          alert: Element | null;
          inserted: string[];
          alertChanges: number;
        };
      };
      return {
        statusKept:
          w.__live.status?.isConnected === true &&
          document.querySelector('.local-status') === w.__live.status,
        alertKept:
          w.__live.alert?.isConnected === true &&
          document.querySelector('[role="alert"]') === w.__live.alert,
        inserted: w.__live.inserted,
        alertChanges: w.__live.alertChanges,
      };
    });

  test('are never recreated while the page renders, and the alert stays empty without an error', async ({
    page,
  }) => {
    await answerLookup(page);
    await expect(page.getByRole('alert')).toHaveText('');
    await watch(page);
    await load(page, { Tribe: 'Midlander', ...equipmentBody });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await resolveButton(page).click();
    await expect(page.getByTestId('lookup-evidence')).toBeVisible();
    await page.getByRole('button', { name: 'Clear file' }).click();
    await expect(page.getByTestId('identity')).toHaveCount(0);
    const result = await report(page);
    expect(result.statusKept).toBe(true);
    expect(result.alertKept).toBe(true);
    expect(result.inserted).toEqual([]);
  });

  test('write a retained error once, not on every render that follows', async ({
    page,
  }) => {
    await answerLookup(page);
    await load(page, { Tribe: 'Midlander', ...equipmentBody });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await watch(page);
    await load(page, {}, 'replacement.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    const afterError = (await report(page)).alertChanges;
    expect(afterError).toBeGreaterThan(0);
    await resolveButton(page).click();
    await expect(page.getByTestId('lookup-evidence')).toBeVisible();
    const result = await report(page);
    expect(result.alertKept).toBe(true);
    expect(result.alertChanges).toBe(afterError);
    expect(result.inserted).toEqual([]);
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
  });

  test('announce the lookup result through a region that is already in the page', async ({
    page,
  }) => {
    await answerLookup(page);
    await load(page, { Tribe: 'Midlander', ...equipmentBody });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await watch(page);
    await resolveButton(page).click();
    await expect(page.locator('#lookup-announcer')).toContainText(
      'Lookup finished',
    );
    expect((await report(page)).inserted).toEqual([]);
  });

  test('keep the stored-values page status in place while paging', async ({
    page,
  }) => {
    await load(page, {
      HairTone: 0,
      ...Object.fromEntries(
        Array.from({ length: 250 }, (_, i) => [`extra${i}`, 'x']),
      ),
    });
    await expect(page.getByTestId('identity')).toBeVisible();
    // Every render moves the stored panel, so let the colors arrive before watching.
    await expect(page.getByTestId('swatches')).not.toContainText('Loading');
    await page.getByText('Stored values', { exact: true }).click();
    const range = page.getByTestId('stored-values').locator('[role="status"]');
    await expect(range).toHaveText('Fields 1–200 of 251');
    await watch(page);
    await page.evaluate(() => {
      const node = document.querySelector(
        '[data-testid="stored-values"] [role="status"]',
      );
      (window as typeof window & { __range: Element | null }).__range = node;
    });
    await page.getByRole('button', { name: 'Show next 200 fields' }).click();
    await expect(range).toHaveText('Fields 201–251 of 251');
    await page
      .getByRole('button', { name: 'Show previous 200 fields' })
      .click();
    await expect(range).toHaveText('Fields 1–200 of 251');
    expect((await report(page)).inserted).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __range: Element | null }).__range ===
          document.querySelector(
            '[data-testid="stored-values"] [role="status"]',
          ),
      ),
    ).toBe(true);
  });
  test('refill the alert after the pause when the same rejection repeats', async ({
    page,
  }) => {
    await page.clock.install();
    await load(page, {}, 'first.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    await load(page, {}, 'second.pose');
    await expect(page.getByRole('alert')).toHaveText('');
    await page.clock.runFor(100);
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
  });
  test('do not bring back an error that was cleared during the pause', async ({
    page,
  }) => {
    await page.clock.install();
    await load(page, { Tribe: 'Midlander' });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await load(page, {}, 'first.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    await load(page, {}, 'second.pose');
    await expect(page.getByRole('alert')).toHaveText('');
    await page.getByRole('button', { name: 'Clear file' }).click();
    await expect(page.getByTestId('identity')).toHaveCount(0);
    await page.clock.runFor(200);
    await expect(page.getByRole('alert')).toHaveText('');
  });
  test('announce an error again when the same rejection repeats', async ({
    page,
  }) => {
    await watch(page);
    await load(page, {}, 'first.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    const first = (await report(page)).alertChanges;
    await load(page, {}, 'second.pose');
    await expect
      .poll(async () => (await report(page)).alertChanges)
      .toBeGreaterThan(first);
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
  });
});
