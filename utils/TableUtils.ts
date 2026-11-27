import type { Locator, Page } from '@playwright/test';

/**
 * Cell of `row` in the column whose header is `header` (e.g. "Status").
 * Looks the column up by its header text, so a new column added by the
 * developers does not shift the cells the tests read.
 */
export async function cellByHeader(page: Page, row: Locator, header: string): Promise<Locator> {
  const headers = (await page.locator('table thead th').allInnerTexts()).map((h) => h.trim().toLowerCase());
  const index = headers.findIndex((h) => h === header.toLowerCase() || h.startsWith(header.toLowerCase()));
  if (index === -1) {
    throw new Error(`Column "${header}" not found. Columns: ${headers.filter(Boolean).join(', ')}`);
  }
  return row.locator('td').nth(index);
}
