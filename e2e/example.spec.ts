import { _electron, expect, test } from '@playwright/test'

test.beforeEach(async () => {
  await _electron.launch({
    args: ['.'],
    env: {
      NODE_ENV: 'development',
    },
  })
})

test('example', async ({ page }) => {
  await page.goto('https://playwright.dev/')
  await expect(page).toHaveTitle(/Playwright/)
})
