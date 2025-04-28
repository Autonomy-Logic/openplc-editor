import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

let page: Page
let electronApp: ElectronApplication

test.beforeEach(async () => {
  electronApp = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js')],
    env: {
      NODE_ENV: 'development',
    },
  })
  page = await electronApp.firstWindow()
})

test('page is visible', () => expect(page).toBeDefined())

test.afterAll(async () => {
  await electronApp.close()
})
