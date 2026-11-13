import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { launch, quitApp } from './helpers/ethercat-project'
import { writeStProgramProject } from './helpers/st-program-project'

/** Reads the `version` field of the repository root `package.json`. */
function releaseVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) throw new Error('no version')
  if (typeof manifest.version !== 'string') throw new Error('version is not a string')
  return manifest.version
}

test('Help > About shows the release version of the editor', async () => {
  test.setTimeout(120000)
  const { userData } = writeStProgramProject('openplc-e2e-about-version', {
    name: 'about_project',
    program: 'PROGRAM main\n  VAR\n    x : INT;\n  END_VAR\n\nx := 1;\n\nEND_PROGRAM\n',
    enums: [],
  })
  const { app, page } = await launch(userData)
  try {
    await expect(page.getByText('about_project', { exact: true }).first()).toBeVisible({ timeout: 30000 })
    await app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Help')
      const about = help?.submenu?.items.find((item) => item.label === 'About')
      if (about === undefined) throw new Error('Help > About is not in the application menu')
      about.click()
    })

    await expect(page.getByRole('heading', { name: `OpenPLC Editor ${releaseVersion()}`, exact: true })).toBeVisible({
      timeout: 15000,
    })
  } finally {
    await quitApp(app, page)
  }
})
