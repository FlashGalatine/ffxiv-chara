import { expect, test } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('keeps every muted text color at 4.5:1 or better against the background it sits on', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Anamnesis', exact: true }).click();
  await expect(page.getByTestId('identity')).toBeVisible();
  await page.getByText('Stored values', { exact: true }).click();
  const failures = await page.evaluate(() => {
    const channels = (color: string) =>
      (color.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const background = (element: Element): number[] => {
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const [r = 0, g = 0, b = 0, a = 1] = channels(
          getComputedStyle(node).backgroundColor,
        );
        if (a > 0) return [r, g, b];
      }
      return [255, 255, 255];
    };
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue('--muted')
      .trim();
    document.body.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const out: string[] = [];
    let checked = 0;
    for (const element of document.body.querySelectorAll('*')) {
      if (
        ![...element.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
        ) ||
        getComputedStyle(element).color !== muted
      )
        continue;
      checked++;
      const a = luminance(channels(muted));
      const b = luminance(background(element));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5)
        out.push(
          `${element.className || element.tagName}: ${ratio.toFixed(2)}`,
        );
    }
    return { out, checked };
  });
  expect(failures.checked).toBeGreaterThan(3);
  expect(failures.out).toEqual([]);
});
