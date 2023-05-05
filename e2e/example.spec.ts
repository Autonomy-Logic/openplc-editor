import { _electron as electron, expect, test } from '@playwright/test';

test('homepage has a title', async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'] });
  const page = await app.firstWindow();
  expect(await page.title()).toBe('Open PLC Editor');
  await page.screenshot({ path: 'e2e/screenshots/example.png' });
});
