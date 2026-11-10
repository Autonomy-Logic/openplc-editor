/**
 * Installing a board package installs its arduino-cli core and libraries behind a
 * blocking progress modal; Reinstall installs only what is missing and can be
 * cancelled; uninstalling removes what no other package needs.
 *
 * Installs the signed SLM-CPU-0 package (FACTS:stm32 pinned core, open62541 and
 * Settimino git libraries) into an empty arduino-cli folder. Archives come from this
 * machine's arduino-cli download cache when present; index refreshes and the git
 * libraries need the network. Needs a production build plus the preload copy (see
 * "Electron e2e" in CLAUDE.md). OPENPLC_E2E_SLM_VPP overrides the package file.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { SOURCE_USER_DATA } from './helpers/arduino-build-project'
import { launch, PROJECT_NAME, quitApp, UR20_STATION, writeEthercatProject } from './helpers/ethercat-project'

const VPP =
  process.env.OPENPLC_E2E_SLM_VPP ??
  join(__dirname, '..', '..', 'openplc-packages', 'dist', 'com.synergy-logic.slm-rp4-1.1.0.vpp')
const PACKAGE_ID = 'com.synergy-logic.slm-rp4'

const stepText = (page: Page) => page.getByTestId('package-install-step')
const listEntry = (page: Page) =>
  page.getByRole('button', { name: new RegExp(`^${PACKAGE_ID.replace(/\./g, '\\.')} v`) })

async function waitForModalToClose(page: Page): Promise<void> {
  await expect(stepText(page)).toBeHidden({ timeout: 900000 })
}

test('a board package installs, reinstalls and uninstalls its arduino-cli dependencies', async () => {
  test.skip(!existsSync(VPP), `package file not found: ${VPP}`)
  test.setTimeout(1800000)
  const root = join(realpathSync(tmpdir()), 'openplc-e2e-vpp-dependencies')
  const { userData } = writeEthercatProject(root, '', UR20_STATION)
  const data = join(userData, 'arduino', 'data')
  mkdirSync(data, { recursive: true })
  const cache = join(SOURCE_USER_DATA, 'arduino', 'data', 'staging')
  if (existsSync(cache)) symlinkSync(cache, join(data, 'staging'))
  const core = join(data, 'packages', 'FACTS', 'hardware', 'stm32')
  const libraries = join(userData, 'arduino', 'user', 'libraries')

  const { app, page } = await launch(userData)
  try {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] })
    }, VPP)
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    // File > Board Package Manager... sends this event; repeat it until the workspace has subscribed.
    await expect
      .poll(
        async () => {
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
            win?.webContents.send('packages:open-manager')
          })
          return page.getByRole('button', { name: 'Add package' }).isVisible()
        },
        { timeout: 60000, intervals: [2000] },
      )
      .toBe(true)

    // Install from file: the modal names each step, then the package is listed with its core in place.
    await page.getByRole('button', { name: 'Add package' }).click({ timeout: 30000 })
    await page.getByText('Add from file...', { exact: true }).click()
    // open62541 and Settimino are steps too unless the Arduino sketchbook already has them.
    await expect(stepText(page)).toContainText(/Installing core FACTS:stm32 0\.1\.0 \(1 of [13]\)/, {
      timeout: 120000,
    })
    await waitForModalToClose(page)
    await expect(listEntry(page)).toBeVisible({ timeout: 30000 })
    expect(existsSync(join(core, '0.1.0'))).toBe(true)
    const ownsGitLibraries = existsSync(join(libraries, 'open62541'))

    // Reinstall with nothing missing installs nothing.
    await listEntry(page).click()
    await page.getByRole('button', { name: 'Reinstall', exact: true }).click()
    await page.waitForTimeout(5000)
    await expect(stepText(page)).toBeHidden()

    // Reinstall after the core went missing installs only the core.
    rmSync(core, { recursive: true, force: true })
    await page.getByRole('button', { name: 'Reinstall', exact: true }).click()
    await expect(stepText(page)).toContainText('Installing core FACTS:stm32 0.1.0 (1 of 1)', { timeout: 120000 })
    await waitForModalToClose(page)
    expect(existsSync(join(core, '0.1.0'))).toBe(true)

    // Cancel stops a running Reinstall without an error, and the core stays missing.
    rmSync(core, { recursive: true, force: true })
    await page.getByRole('button', { name: 'Reinstall', exact: true }).click()
    await expect(stepText(page)).toContainText('Installing core FACTS:stm32', { timeout: 120000 })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await waitForModalToClose(page)
    await expect(page.getByText('Package reinstall failed')).toHaveCount(0)
    expect(existsSync(join(core, '0.1.0', 'platform.txt'))).toBe(false)

    // Reinstall again repairs it.
    await page.getByRole('button', { name: 'Reinstall', exact: true }).click()
    await expect(stepText(page)).toContainText('Installing core FACTS:stm32 0.1.0 (1 of 1)', { timeout: 120000 })
    await waitForModalToClose(page)
    expect(existsSync(join(core, '0.1.0', 'platform.txt'))).toBe(true)

    // Uninstall removes the core and the libraries no other package declares.
    await page.getByRole('button', { name: 'Remove package' }).click()
    await expect(listEntry(page)).toHaveCount(0, { timeout: 60000 })
    await expect.poll(() => existsSync(join(core, '0.1.0')), { timeout: 60000 }).toBe(false)
    if (ownsGitLibraries) expect(existsSync(join(libraries, 'open62541'))).toBe(false)
  } finally {
    await quitApp(app, page)
  }
})
