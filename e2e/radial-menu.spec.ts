/**
 * Radial menu and click-to-place in the LD and FBD editors.
 *
 * Right click on the programming area opens the radial menu; picking an element
 * (or pressing Alt + digit) sticks it to the cursor, and a left click inserts
 * it (LD: on a rung placeholder, FBD: anywhere on the canvas). Escape or a click
 * away cancels. The toolbox drag-and-drop path is checked to still work.
 *
 * Needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-radial-menu')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')

const vars = `  VAR
    a : BOOL;
  END_VAR
`

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'devices'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'radial-menu', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'ldmain', task: 'task0' }],
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(FIXTURE, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v3',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(FIXTURE, 'pous', 'programs', 'ldmain.ld'),
    `PROGRAM ldmain\n${vars}\n${JSON.stringify({ name: 'ldmain', rungs: [] })}\nEND_PROGRAM\n`,
  )
  writeFileSync(
    join(FIXTURE, 'pous', 'programs', 'fbdmain.fbd'),
    `PROGRAM fbdmain\n${vars}\n${JSON.stringify({
      name: 'fbdmain',
      rung: { comment: '', nodes: [], edges: [], selectedNodes: [] },
    })}\nEND_PROGRAM\n`,
  )

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'radial-menu',
        path: FIXTURE,
        projectFilePath: join(FIXTURE, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(USER_DATA, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          // Below ~1024px wide the app shows its "not supported on mobile" screen.
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))
            win?.setSize(1500, 950)
          })
          return { app, page: w }
        }
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

const center = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const visible = (page: Page, selector: string) => page.locator(`${selector}:visible`)

/** Display > Radial Menu from the native menu; waits until the renderer has stored the new value. */
async function toggleRadialMenu(expected: boolean) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('workspace:toggle-radial-menu-accelerator')
  })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ui-preferences-v1')))
    .toBe(JSON.stringify({ radialMenuEnabled: expected }))
}

async function rightClick(page: Page, point: { x: number; y: number }) {
  await page.mouse.click(point.x, point.y, { button: 'right' })
}

async function pickFromMenu(page: Page, id: string, label: string) {
  const item = page.getByTestId(`radial-menu-item-${id}`)
  const point = await center(item)
  await page.mouse.move(point.x, point.y)
  await expect(page.getByTestId('radial-menu-label')).toHaveText(label)
  await page.mouse.click(point.x, point.y)
  await expect(page.getByTestId('radial-menu')).toHaveCount(0)
  await expect(page.getByTestId('cursor-follower')).toContainText(label)
}

/** Moves over the rung so the placeholders render, then returns the centre of the first one. */
async function firstPlaceholder(page: Page, pane: Locator) {
  const paneCenter = await center(pane)
  await page.mouse.move(paneCenter.x, paneCenter.y)
  await page.mouse.move(paneCenter.x + 5, paneCenter.y + 5)
  const placeholder = visible(page, '.react-flow__node-placeholder').first()
  await expect(placeholder).toBeVisible()
  return center(placeholder)
}

let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial', timeout: 120000 })

test.beforeAll(async () => {
  test.setTimeout(180000)
  writeFixture()
  ;({ app, page } = await launch())
  await page.getByText('radial-menu', { exact: true }).first().click({ timeout: 60000 })
})

test.afterAll(async () => {
  await app?.close()
})

test.describe('ladder', () => {
  test.beforeAll(async () => {
    test.setTimeout(120000)
    await page.getByText('ldmain', { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('Create new rung').locator('..').locator('button, svg').last().click({ timeout: 30000 })
    await expect(visible(page, '.react-flow__pane').first()).toBeVisible()
  })

  test('right click opens the radial menu with the ladder elements; Escape closes it', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    await rightClick(page, await center(pane))
    await expect(page.getByTestId('radial-menu')).toBeVisible()
    await expect(page.getByTestId('radial-menu').getByRole('menuitem')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('radial-menu')).toHaveCount(0)
  })

  test('a left click away from the options closes the menu', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    const point = await center(pane)
    await rightClick(page, point)
    await page.mouse.click(point.x + 300, point.y)
    await expect(page.getByTestId('radial-menu')).toHaveCount(0)
  })

  test('a right click elsewhere in the area reopens the menu at the new position', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    const point = await center(pane)
    await rightClick(page, point)
    const before = await center(page.getByTestId('radial-menu'))
    await rightClick(page, { x: point.x + 260, y: point.y })
    await expect(page.getByTestId('radial-menu')).toHaveCount(1)
    const after = await center(page.getByTestId('radial-menu'))
    expect(after.x).toBeGreaterThan(before.x)
    await page.keyboard.press('Escape')
  })

  test('picking Contact sticks it to the cursor and a click on a placeholder inserts it', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    await rightClick(page, await center(pane))
    await pickFromMenu(page, 'contact', 'Contact')
    const target = await firstPlaceholder(page, pane)
    await page.mouse.click(target.x, target.y)
    await expect(visible(page, '.react-flow__node-contact')).toHaveCount(1)
    await expect(page.getByTestId('cursor-follower')).toHaveCount(0)
    await expect(visible(page, '.react-flow__node-placeholder')).toHaveCount(0)
  })

  test('Alt + 2 arms a coil that is inserted on a placeholder', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    // The new contact's variable field has focus; the shortcut must still work from there.
    const field = page.locator('textarea[placeholder="???"]:focus')
    await expect(field).toHaveCount(1)
    const before = await field.inputValue()
    await page.keyboard.press('Alt+2')
    await expect(page.getByTestId('cursor-follower')).toContainText('Coil')
    expect(await field.inputValue(), 'the chord types nothing into the field').toBe(before)
    const placeholders = visible(page, '.react-flow__node-placeholder')
    await firstPlaceholder(page, pane)
    const target = await center(placeholders.last())
    await page.mouse.click(target.x, target.y)
    await expect(visible(page, '.react-flow__node-coil')).toHaveCount(1)
  })

  test('a click away from any placeholder cancels the insertion', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    const box = await pane.boundingBox()
    if (!box) throw new Error('no pane')
    await page.keyboard.press('Alt+1')
    await expect(page.getByTestId('cursor-follower')).toContainText('Contact')
    await page.mouse.move(box.x + box.width - 20, box.y + 15)
    await page.mouse.click(box.x + box.width - 20, box.y + 15)
    await expect(page.getByTestId('cursor-follower')).toHaveCount(0)
    await expect(visible(page, '.react-flow__node-contact')).toHaveCount(1)
  })

  test('Escape cancels an armed element', async () => {
    await page.keyboard.press('Alt+3')
    await expect(page.getByTestId('cursor-follower')).toContainText('Block')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cursor-follower')).toHaveCount(0)
  })

  test('the toolbox drag-and-drop still inserts elements', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    // The ladder toolbox order is Block, Coil, Contact.
    await page
      .locator('[draggable="true"]')
      .nth(2)
      .dragTo(pane, { targetPosition: { x: 40, y: 50 } })
    await expect(visible(page, '.react-flow__node-contact')).toHaveCount(2)
  })
})

test.describe('fbd', () => {
  test.beforeAll(async () => {
    test.setTimeout(120000)
    await page.getByText('fbdmain', { exact: true }).first().click({ timeout: 30000 })
    await expect(visible(page, '.react-flow__pane').first()).toBeVisible()
  })

  test('right click lists the six FBD elements and Comment is placed where clicked', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    const point = await center(pane)
    await rightClick(page, point)
    await expect(page.getByTestId('radial-menu').getByRole('menuitem')).toHaveCount(6)
    await pickFromMenu(page, 'comment', 'Comment')
    await page.mouse.click(point.x - 200, point.y - 100)
    await expect(visible(page, '.react-flow__node-comment')).toHaveCount(1)
  })

  test('Alt + 1 places an input variable and Alt + 2 an output variable', async () => {
    const pane = visible(page, '.react-flow__pane').first()
    const point = await center(pane)
    await page.keyboard.press('Alt+1')
    await page.mouse.click(point.x - 100, point.y + 80)
    await expect(visible(page, '.react-flow__node-input-variable')).toHaveCount(1)
    await page.keyboard.press('Alt+2')
    await page.mouse.click(point.x + 150, point.y + 80)
    await expect(visible(page, '.react-flow__node-output-variable')).toHaveCount(1)
  })

  test('a click on the zoom controls cancels instead of placing', async () => {
    await page.keyboard.press('Alt+4')
    await expect(page.getByTestId('cursor-follower')).toContainText('Connector')
    await page.locator('.react-flow__controls:visible button').first().click()
    await expect(page.getByTestId('cursor-follower')).toHaveCount(0)
    await expect(visible(page, '.react-flow__node-connector')).toHaveCount(0)
  })

  test('disabling the radial menu keeps the shortcuts', async () => {
    await toggleRadialMenu(false)
    const pane = visible(page, '.react-flow__pane').first()
    const point = await center(pane)
    await rightClick(page, point)
    await expect(page.getByTestId('radial-menu')).toHaveCount(0)

    await page.keyboard.press('Alt+5')
    await page.mouse.click(point.x + 150, point.y - 120)
    await expect(visible(page, '.react-flow__node-continuation')).toHaveCount(1)

    await toggleRadialMenu(true)
    await rightClick(page, point)
    await expect(page.getByTestId('radial-menu')).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
