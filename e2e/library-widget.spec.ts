/**
 * A widget authored in a library project, end to end in the built app: the + menu's Widget creates a widget block, the
 * library build compiles it into the archive with the HMI core header requirement, the archive installs like any
 * library, its widget shows in the HMI palette and builds on a screen; and a PLC program that uses a widget fails its
 * build early with STruC++'s reason on the Console.
 *
 * Running it needs `npm run setup:hmi-widgets`, a production build and the preload at the path a NON-packaged app looks
 * for it; see "Electron e2e" in CLAUDE.md.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { waitForText } from './helpers/app-console'
import { buildFromMenu, launch, quitApp } from './helpers/ethercat-project'
import { hmiFixture, launchHmiApp, leaf, status, waitFor, writeHmiFixture } from './helpers/hmi-app'
import {
  buildLibrary,
  builtLibraryPath,
  consoleOf,
  type LibraryFixture,
  writeConsumerProject,
  writeLibraryProject,
} from './helpers/library-project'

const LIBRARY: LibraryFixture = {
  name: 'badge_lib',
  globals: [],
  lists: [],
  functionBlocks: {
    COUNTER: 'FUNCTION_BLOCK COUNTER\n  VAR\n    n : INT;\n  END_VAR\n\nn := n + 1;\n\nEND_FUNCTION_BLOCK\n',
  },
}

const WIDGET = 'TankBadge'

const MAIN = `PROGRAM Main
  VAR
    Level : BOOL := TRUE;
  END_VAR
END_PROGRAM
`

const PANEL = `FUNCTION_BLOCK Panel EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 12, Padding := 16);
    Badge : ${WIDGET} := (Parent := 'Col');
  END_VAR
  Badge.Value := instance0.Main.Level;
END_FUNCTION_BLOCK
`

/** The archive's chunk of a block with the headers it needs. */
function chunkHeaders(archivePath: string, name: string): unknown {
  const archive: unknown = JSON.parse(readFileSync(archivePath, 'utf-8'))
  const chunks = typeof archive === 'object' && archive !== null && 'chunks' in archive ? archive.chunks : []
  const chunk = Array.isArray(chunks)
    ? chunks.find((c: unknown) => typeof c === 'object' && c !== null && 'name' in c && c.name === name)
    : undefined
  return typeof chunk === 'object' && chunk !== null && 'headers' in chunk ? chunk.headers : undefined
}

/** Builds the library project with one widget created from the + menu; returns the archive's path. */
async function buildWidgetLibrary(): Promise<string> {
  const { project, userData } = writeLibraryProject('openplc-e2e-library-widget', LIBRARY)
  const { app, page } = await launch(userData)
  try {
    await page.getByText(LIBRARY.name, { exact: true }).first().click({ timeout: 30000 })
    await page.locator('#create-plc-element-trigger').click({ timeout: 30000 })
    await expect(page.locator('#create-hmi-widget-trigger')).toHaveText(/^Widget$/, { timeout: 10000 })
    await page.locator('#create-hmi-widget-trigger').hover()
    await page.locator('#hmi-name').fill(WIDGET)
    await page.locator('#create-hmi-widget-content').getByRole('button', { name: 'Create' }).click()
    await expect(page.locator('li.group').getByText(WIDGET, { exact: true }).first()).toBeVisible({ timeout: 30000 })
    await buildLibrary(page)
    await waitForText(page, new RegExp(`Library built successfully: build/${LIBRARY.name}\\.stlib`), { timeout: 60000 })
    expect(existsSync(join(project, 'hmi', 'widgets', `${WIDGET}.st`))).toBe(true)
  } finally {
    await quitApp(app, page)
  }
  return builtLibraryPath(project, LIBRARY.name)
}

/** Puts a built archive among a profile's installed libraries, as the library manager stores it. */
function install(userData: string, name: string, archivePath: string): void {
  const libraries = join(userData, 'libraries')
  mkdirSync(join(libraries, name), { recursive: true })
  const stlibPath = join(libraries, name, `${name}.stlib`)
  writeFileSync(stlibPath, readFileSync(archivePath))
  writeFileSync(
    join(libraries, 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      libraries: { [name]: { version: '1.0.0', installedAt: new Date().toISOString(), stlibPath, origin: 'stlib' } },
    }),
  )
}

async function previewReady(page: Page): Promise<boolean> {
  const state = await status(page)
  if (state.startsWith('failed'))
    throw new Error(`the preview failed: ${(await page.getByTestId('hmi-errors').allInnerTexts()).join(' | ')}`)
  return state.startsWith('ready')
}

test.describe('widgets authored in a library project', () => {
  test.setTimeout(180000)

  test('builds a library widget, installs it, offers it in the palette and builds a screen with it', async () => {
    const archive = await buildWidgetLibrary()
    expect(chunkHeaders(archive, WIDGET.toUpperCase())).toEqual([{ name: 'hmi_core.h', version: '1' }])
    expect(chunkHeaders(archive, 'COUNTER')).toEqual([])

    const F = hmiFixture('library-widget-screen')
    writeHmiFixture(F, { main: MAIN, screens: { Panel: PANEL }, startScreen: 'Panel' })
    install(F.userData, LIBRARY.name, archive)
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(F, page, 'the HMI branch', async () => (await leaf(page, 'Panel').count()) > 0)
      await leaf(page, 'Panel').click()
      await waitFor(F, page, 'the preview with the library widget', () => previewReady(page), 90000)
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await waitFor(F, page, 'the library widget in the palette', () =>
        page.getByTestId(`hmi-palette-${WIDGET}`).isVisible(),
      )
      await page.screenshot({ path: join(F.shots, 'palette.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('fails a PLC build that uses a widget early, with the reason on the Console', async () => {
    const { userData } = writeConsumerProject('openplc-e2e-plc-uses-widget', {
      name: 'plc_uses_widget',
      program: 'PROGRAM main\n  VAR\n    b : HmiButton;\n  END_VAR\n\nb();\n\nEND_PROGRAM\n',
      library: { name: LIBRARY.name, archive: readFileSync(builtLibraryPath(libraryProject(), LIBRARY.name), 'utf-8') },
    })
    const { app, page } = await launch(userData)
    try {
      await page.getByText('plc_uses_widget', { exact: true }).first().click({ timeout: 30000 })
      await buildFromMenu(page, 'Build only')
      await waitForText(page, /HMIBUTTON \(library standard-widgets\) needs hmi_core\.h version \d+/, {
        timeout: 90000,
        failure: /Build finished successfully|compiled successfully/i,
      })
      await expect(
        consoleOf(page)
          .getByText(/which this build does not provide/)
          .first(),
      ).toBeVisible()
    } finally {
      await quitApp(app, page)
    }
  })
})

/** The library project the first test builds (`writeLibraryProject` puts it there). */
function libraryProject(): string {
  return join(realpathSync(tmpdir()), 'openplc-e2e-library-widget', 'project')
}
