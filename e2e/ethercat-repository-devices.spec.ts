import { readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { saveProject } from './helpers/electron-editor'
import { EK1818_STATION, launch, PROJECT_NAME, quitApp, writeEthercatProject } from './helpers/ethercat-project'

const DRIVE_ESI = join(__dirname, 'fixtures', 'ethercat-defaultdata', '11111111-2222-4333-8444-555555555555.xml')
const VENDOR_ESI = join(__dirname, '..', 'src', 'backend', 'shared', 'ethercat', '__tests__', 'fixtures', 'esi-real')
const COUPLER_ESI = join(VENDOR_ESI, 'weidmueller-ur20-fbc.xml')
const MODULES_ESI = join(VENDOR_ESI, 'weidmueller-ur20-io.xml')

/** The modules added to the coupler, by their ESI name and ident. */
const MODULES = [
  { name: 'UR20-4DI-P', ident: '0x00091F84' },
  { name: 'UR20-4DO-P', ident: '0x01012FA0' },
]

/** A configured device as the bus file stores it. */
interface StoredDevice {
  name: string
  isModularCoupler?: boolean
  txPdos?: Array<{ index: string; name: string }>
  modules?: Array<{ slot: number; ident: string }>
}

/** The devices of the bus file `devices/remote/ecat_bus.json`. */
function storedDevices(project: string): StoredDevice[] {
  const bus: { ethercatConfig: { devices: StoredDevice[] } } = JSON.parse(
    readFileSync(join(project, 'devices', 'remote', 'ecat_bus.json'), 'utf-8'),
  )
  return bus.ethercatConfig.devices
}

/** Adds the repository device found by @p search through the bus editor's Add Device modal. */
async function addDeviceFromRepository(page: Page, search: string, deviceName: string): Promise<void> {
  await page.getByRole('button', { name: 'Add Device' }).click({ timeout: 30000 })
  const modal = page.getByRole('dialog')
  await modal.getByPlaceholder('Search devices by name, product code, or vendor...').fill(search)
  await modal.getByRole('button', { name: new RegExp(deviceName) }).click({ timeout: 30000 })
  await modal.getByRole('button', { name: 'Add Device', exact: true }).click()
  await expect(modal).toHaveCount(0, { timeout: 30000 })
}

/** Adds the module named @p moduleName through the coupler's Add Module modal. */
async function addModule(page: Page, moduleName: string): Promise<void> {
  await page.getByRole('button', { name: 'Add Module' }).click({ timeout: 30000 })
  const modal = page.getByRole('dialog')
  await modal.getByPlaceholder('Search modules by name, ident, or vendor...').fill(moduleName)
  await modal.getByRole('button', { name: new RegExp(`^${moduleName}\\b`) }).click({ timeout: 30000 })
  await modal.getByRole('button', { name: 'Add Module', exact: true }).click()
  await expect(modal).toHaveCount(0, { timeout: 30000 })
}

/** Asserts the open coupler lists each of MODULES in its Configured Modules table, in slot order. */
async function expectConfiguredModules(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: new RegExp(`^Configured Modules\\s*\\(${MODULES.length}\\)$`) }),
  ).toBeVisible({
    timeout: 30000,
  })
  for (const [i, module] of MODULES.entries()) {
    const cells = page.getByRole('row').filter({ hasText: module.ident }).getByRole('cell')
    await expect(cells).toHaveText([String(i + 1), new RegExp(`^${module.name}\\b`), module.ident], { timeout: 30000 })
  }
}

test('a drive shows its PDOs and a modular coupler keeps its modules across save and reopen', async () => {
  test.setTimeout(240000)
  const root = join(realpathSync(tmpdir()), `openplc-e2e-ethercat-repository-devices-${test.info().repeatEachIndex}`)
  const { project, userData } = writeEthercatProject(root, '', EK1818_STATION)

  let { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('ecat_bus', { exact: true }).first().dblclick({ timeout: 60000 })
    await page.getByTestId('ethercat-tab-repository').click({ timeout: 60000 })
    await page.getByTestId('esi-upload-input').setInputFiles([DRIVE_ESI, COUPLER_ESI, MODULES_ESI])
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(3, { timeout: 60000 })
    await expect(page.getByTestId('esi-upload-errors')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Bus', exact: true }).click()

    await addDeviceFromRepository(page, 'Interpolation drive', 'Interpolation drive')
    await addDeviceFromRepository(page, 'UR20-FBC-EC', 'UR20-FBC-EC')

    await page.getByText('KS100E-LIKE', { exact: true }).first().dblclick({ timeout: 60000 })
    await page.getByRole('tab', { name: 'Process Data', exact: true }).click({ timeout: 60000 })
    const pdoRow = page.getByRole('row').filter({ hasText: 'TxPDO 0' })
    await expect(pdoRow).toHaveCount(1, { timeout: 30000 })
    await expect(pdoRow).toContainText(/1A00/i)
    await expect(pdoRow).toContainText('TX')
    await expect(pdoRow).toContainText('SM3')

    await page.getByText('UR20-FBC-EC', { exact: true }).first().dblclick({ timeout: 60000 })
    await expect(page.getByRole('tab', { name: 'Modules', exact: true })).toHaveAttribute('data-state', 'active', {
      timeout: 30000,
    })
    for (const module of MODULES) await addModule(page, module.name)
    await expectConfiguredModules(page)

    await saveProject(app)
    await expect
      .poll(() => storedDevices(project).find((d) => d.isModularCoupler === true)?.modules?.length ?? 0, {
        timeout: 30000,
      })
      .toBe(2)
    const devices = storedDevices(project)
    const drive = devices.find((d) => d.txPdos?.some((p) => p.name === 'TxPDO 0'))
    expect(drive?.txPdos?.map((p) => p.index.toUpperCase())).toEqual([expect.stringContaining('1A00')])
    const coupler = devices.find((d) => d.isModularCoupler === true)
    expect(coupler?.modules?.map((m) => ({ slot: m.slot, ident: m.ident.toUpperCase() }))).toEqual(
      MODULES.map((m, i) => ({ slot: i + 1, ident: m.ident.toUpperCase() })),
    )
    await quitApp(app, page)
    ;({ app, page } = await launch(userData))
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('ecat_bus', { exact: true }).first().click({ timeout: 60000 })
    await page
      .getByText(coupler?.name ?? 'UR20-FBC-EC', { exact: true })
      .first()
      .dblclick({ timeout: 60000 })
    await expectConfiguredModules(page)
  } finally {
    await quitApp(app, page)
  }
})
