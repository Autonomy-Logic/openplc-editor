/**
 * Package trust in the Package Manager, end to end. The Autonomy-signed catalog package (`com.openplc.fx3u-compatible`
 * 2.1.0) installs through "Add from file...", is listed, its board can be picked in the open project, it is kept when
 * a project for that board opens, and that project builds. A package signed by another key (the synthetic
 * `eqsp32-dev`) is refused at "Add from file..." with the reason shown, also when it claims the Autonomy key id, and
 * one copied into the profile by hand is removed when a project opens.
 *
 * Running needs a production build; see "Electron e2e" in CLAUDE.md. `E2E_PACKAGED_APP` runs it against a test-only
 * packaged build (`npm run package:test`), where the trust module is the one that build generated. The build case
 * borrows this machine's arduino-cli cores (`OPENPLC_E2E_SOURCE_USER_DATA`) and skips without the STM32 core 2.12.0.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import {
  EQSP32_PACKAGE_ID,
  FX3U_BOARD,
  FX3U_PACKAGE_ID,
  FX3U_VPP,
  installByHand,
  readRegistryPackages,
  signTestPackage,
  zipPackage,
} from '../src/backend/editor/package-trust/__tests__/fixtures/sign-test-package'
import { APP_FAILURE, pageText, waitForApp, waitForText } from './helpers/app-console'
import { SOURCE_USER_DATA } from './helpers/arduino-build-project'
import { saveProject, shutdown } from './helpers/electron-editor'
import {
  type EditorSession,
  freshDirectory,
  freshProfile,
  launchEditor,
  openNewProject,
} from './helpers/editor-session'

const STM32_CORE = join(SOURCE_USER_DATA, 'arduino', 'data', 'packages', 'STMicroelectronics', 'hardware', 'stm32')
const STM32_VERSION = '2.12.0'

/** What the Package Manager or a build shows when an install or a build did not go through. */
const INSTALL_FAILURE = /Package import failed|Installing core|Installing library|Stopping compilation process/
const BUILD_FAILURE = new RegExp(
  `${APP_FAILURE.source}|Stopping compilation process|no longer matches its signature`,
  'i',
)

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** Writes a one-program project for @p board under a new folder and returns that folder, for `openNewProject`. */
function projectFixture(label: string, board: string): string {
  const fixture = join(freshDirectory(label), 'fixture')
  mkdirSync(join(fixture, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(fixture, 'devices'), { recursive: true })
  writeFileSync(
    join(fixture, 'project.json'),
    JSON.stringify({
      meta: { name: label, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(fixture, 'devices', 'configuration.json'),
    JSON.stringify({ deviceBoard: board, communicationPort: '', runtimeIpAddress: '', selectedPlatformOptions: {} }),
  )
  writeFileSync(join(fixture, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(fixture, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    counter : INT;\n  END_VAR\n\ncounter := counter + 1;\n\nEND_PROGRAM\n',
  )
  return fixture
}

/**
 * A new profile whose arduino-cli sees this machine's installed cores (and their tools) read-only through a link,
 * with copies of the index files, so a dependency check finds the STM32 core and writes nothing outside the profile.
 */
function profileWithInstalledCores(label: string): string {
  const userData = freshProfile(label)
  const source = join(SOURCE_USER_DATA, 'arduino', 'data')
  const data = join(userData, 'arduino', 'data')
  symlinkSync(join(source, 'packages'), join(data, 'packages'))
  for (const entry of readdirSync(source)) {
    if (/\.(json|sig|yaml)$/.test(entry)) copyFileSync(join(source, entry), join(data, entry))
  }
  return userData
}

/** The board saved in @p project's device configuration, or `undefined` while it cannot be read. */
function savedBoard(project: string): unknown {
  try {
    const config: unknown = JSON.parse(readFileSync(join(project, 'devices', 'configuration.json'), 'utf8'))
    return typeof config === 'object' && config !== null ? Reflect.get(config, 'deviceBoard') : undefined
  } catch {
    return undefined
  }
}

/** Makes the native file picker return @p file, as a user choosing it would. */
const pickFile = (app: ElectronApplication, file: string): Promise<void> =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, file)

const deviceSelection = (page: Page) => page.getByRole('combobox', { name: 'Device selection' })

/** Opens the open project's device Configuration screen and waits for its board selector. */
async function openConfiguration(page: Page): Promise<void> {
  await page.getByText('Configuration', { exact: true }).first().click({ timeout: 30000 })
  await expect(deviceSelection(page)).toBeVisible({ timeout: 30000 })
}

/** Opens the Package Manager the way a user looking for a board does: the board list's last entry. */
async function openPackageManagerFromBoardList(page: Page): Promise<void> {
  await openConfiguration(page)
  await deviceSelection(page).click()
  await page.getByRole('option', { name: '+ Install additional boards...' }).click({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'Installed Packages' })).toBeVisible({ timeout: 30000 })
}

/** Chooses "Add from file..." in the Package Manager with @p vpp as the picked file. */
async function addFromFile(app: ElectronApplication, page: Page, vpp: string): Promise<void> {
  await pickFile(app, vpp)
  await page.getByRole('button', { name: 'Add package' }).click({ timeout: 30000 })
  await page.getByRole('button', { name: 'Add from file...' }).click({ timeout: 15000 })
}

const listEntry = (page: Page, packageId: string) =>
  page.getByRole('button', { name: new RegExp(`^${escape(packageId)} v`) })

/** Opens the Console tab, from the bottom panel's strip when the panel is hidden. */
async function openConsole(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Console' })
  if (!(await tab.isVisible())) {
    await page.getByRole('toolbar', { name: 'Bottom panel' }).getByRole('button', { name: 'Console' }).click()
  }
  await tab.click({ timeout: 30000 })
}

/** Saves a screenshot of the window in the test's output folder, as run evidence. */
const snapshot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ path: test.info().outputPath(`${name}.png`) })

/** The import refusal the Package Manager shows, closed with OK; fails at once if the package was listed instead. */
async function expectImportRefused(page: Page, packageId: string, reason: string, evidence: string): Promise<void> {
  const refusal = page.getByText(`Package signature verification failed: ${reason}`, { exact: true })
  await waitForApp(page, () => refusal.isVisible(), {
    timeout: 30000,
    failure: new RegExp(`${escape(packageId)} v`),
    message: `the import of ${packageId} was never refused`,
  })
  await expect(page.getByText('Package import failed', { exact: true })).toBeVisible()
  await snapshot(page, evidence)
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(refusal).toBeHidden()
}

let session: EditorSession | undefined

test.afterEach(async () => {
  if (session) await shutdown(session.app)
  session = undefined
})

test('an Autonomy-signed package installs from file, its board is picked, kept on project open and builds', async () => {
  const missing = existsSync(join(STM32_CORE, STM32_VERSION))
    ? undefined
    : `the STM32 core ${STM32_VERSION} is not installed in ${SOURCE_USER_DATA}`
  test.skip(missing !== undefined, missing ?? '')
  test.setTimeout(360000)
  const userData = profileWithInstalledCores('package-trust-signed')
  const packages = join(userData, 'packages')
  const editor = await launchEditor('package-trust-signed', userData)
  session = editor
  const { app, page } = editor

  const { path: picked } = await openNewProject(editor, projectFixture('trust-pick', 'OpenPLC Simulator'), 'trust-pick')
  await openConfiguration(page)
  await deviceSelection(page).click()
  await expect(page.getByRole('option', { name: new RegExp(`^${escape(FX3U_BOARD)}`) })).toHaveCount(0)
  await page.getByRole('option', { name: '+ Install additional boards...' }).click({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'Installed Packages' })).toBeVisible({ timeout: 30000 })

  await addFromFile(app, page, FX3U_VPP)
  await waitForApp(page, () => listEntry(page, FX3U_PACKAGE_ID).isVisible(), {
    timeout: 60000,
    failure: INSTALL_FAILURE,
    message: `${FX3U_PACKAGE_ID} was never listed`,
  })
  await expect(listEntry(page, FX3U_PACKAGE_ID)).toContainText('v2.1.0 · 3 devices')
  await expect(page.getByRole('heading', { name: 'FX3U-compatible boards' })).toBeVisible()
  expect(Object.keys(readRegistryPackages(packages))).toEqual([FX3U_PACKAGE_ID])
  expect(existsSync(join(packages, FX3U_PACKAGE_ID, 'signature.json'))).toBe(true)
  await snapshot(page, '1-fx3u-installed')

  await openConfiguration(page)
  await deviceSelection(page).click()
  await snapshot(page, '2-fx3u-boards-listed')
  await page.getByRole('option', { name: FX3U_BOARD, exact: true }).click()
  await expect(deviceSelection(page)).toContainText(FX3U_BOARD)
  await expect
    .poll(
      async () => {
        await saveProject(app)
        return savedBoard(picked)
      },
      { timeout: 30000, intervals: [1000], message: 'the picked board was never saved' },
    )
    .toBe(FX3U_BOARD)

  const { path: project } = await openNewProject(editor, projectFixture('trust-build', FX3U_BOARD), 'trust-build')
  await openConfiguration(page)
  await deviceSelection(page).click()
  await expect(page.getByRole('option', { name: FX3U_BOARD, exact: true })).toHaveAttribute('data-state', 'checked')
  await expect(page.getByRole('option', { name: FX3U_BOARD, exact: true })).toBeEnabled()
  await expect(page.getByText(/^Not available/)).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
  await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })
  await openConsole(page)
  await waitForText(page, new RegExp(`board target: ${escape(FX3U_BOARD)}`), { timeout: 60000, failure: BUILD_FAILURE })
  await waitForText(page, /Compile only mode — skipping upload to Arduino board\./, {
    timeout: 300000,
    failure: BUILD_FAILURE,
  })
  await snapshot(page, '3-fx3u-build-done')
  expect(await pageText(page)).not.toMatch(/Removed untrusted VPP package/)
  expect(savedBoard(project)).toBe(FX3U_BOARD)
  expect(Object.keys(readRegistryPackages(packages))).toEqual([FX3U_PACKAGE_ID])
})

test('a package signed by another key is refused at Add from file, and one added by hand is removed on open', async () => {
  test.setTimeout(180000)
  const work = freshDirectory('package-trust-foreign')
  const foreign = signTestPackage(join(work, 'eqsp32'))
  const foreignVpp = await zipPackage(foreign.dir, join(work, 'com.erqos.eqsp32-1.0.0.vpp'))
  const claimed = signTestPackage(join(work, 'eqsp32-claimed'), { keyId: 'openplc-2026' })
  const claimedVpp = await zipPackage(claimed.dir, join(work, 'com.erqos.eqsp32-claimed.vpp'))

  const userData = freshProfile('package-trust-foreign')
  const packages = join(userData, 'packages')
  const editor = await launchEditor('package-trust-foreign', userData)
  session = editor
  const { app, page } = editor
  await openNewProject(editor, projectFixture('trust-refuse', 'OpenPLC Simulator'), 'trust-refuse')
  await openPackageManagerFromBoardList(page)
  const empty = page.getByText('No packages installed. Click + to add a package.')
  await expect(empty).toBeVisible()

  await addFromFile(app, page, foreignVpp)
  await expectImportRefused(page, EQSP32_PACKAGE_ID, 'Untrusted signing key: eqsp32-dev', 'refused-eqsp32-dev')
  await expect(empty).toBeVisible()
  await expect(listEntry(page, EQSP32_PACKAGE_ID)).toHaveCount(0)

  await addFromFile(app, page, claimedVpp)
  await expectImportRefused(page, EQSP32_PACKAGE_ID, 'Invalid package signature', 'refused-claimed-key-id')
  await expect(empty).toBeVisible()
  expect(readRegistryPackages(packages)).toEqual({})
  expect(readdirSync(packages).filter((entry) => entry !== 'registry.json')).toEqual([])

  const byHand = installByHand(packages, EQSP32_PACKAGE_ID, foreign.dir, ['board'])
  expect(Object.keys(readRegistryPackages(packages))).toEqual([EQSP32_PACKAGE_ID])
  await openNewProject(editor, projectFixture('trust-sweep', 'OpenPLC Simulator'), 'trust-sweep')
  await openConsole(page)
  await waitForText(
    page,
    new RegExp(`Removed untrusted VPP package "${escape(EQSP32_PACKAGE_ID)}": its signature is missing or invalid\\.`),
    { timeout: 30000 },
  )
  await snapshot(page, 'removed-on-open')
  expect(existsSync(byHand)).toBe(false)
  expect(readRegistryPackages(packages)).toEqual({})
  const log = readFileSync(join(userData, 'logs', 'combined.log'), 'utf8')
  expect(log).toContain(`VPP package "${EQSP32_PACKAGE_ID}" was removed at startup`)
  expect(log).toContain('Untrusted signing key: eqsp32-dev')
})
