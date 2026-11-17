/**
 * Containers in the HMI designer, in the built app: a new screen comes with one horizontal stack; a dropped container
 * fills its parent and two containers in one stack split it; a vertical stack lays a tank beside a horizontal stack of
 * buttons; a drop outside every container is refused, also once the default stack is deleted; and a screen whose code
 * puts an element directly on the screen does not build.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md. Every wait also reads the app's own error text and fails at once when the app reports one.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  hmiFixture,
  htmlDrag,
  htmlDragOver,
  launchHmiApp,
  leaf,
  pickLayer,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-layout')
const G = hmiFixture('hmi-layout-code')

const MAIN = 'PROGRAM Main\n  VAR\n    Level : REAL := 6.5;\n  END_VAR\n  Level := Level;\nEND_PROGRAM\n'
const START = `FUNCTION_BLOCK Start EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    Title : HmiLabel := (Text := 'Start', Parent := 'Body');
  END_VAR
END_FUNCTION_BLOCK
`
const LOOSE = `FUNCTION_BLOCK Loose EXTENDS HmiScreen
  VAR
    Side : HmiVerticalStack;
    Lamp : HmiLamp := (Caption := 'On');
  END_VAR
END_FUNCTION_BLOCK
`
const NOTICE = 'Place widgets inside a stack or a diagram'

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)
const ready = (page: Page) => waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)

/** The element names the Layers tab lists, in order. */
async function layers(page: Page): Promise<string[]> {
  await page.getByTestId('hmi-palette-tab-layers').click()
  const ids = await page
    .locator('[data-testid^="hmi-outline-"][role="treeitem"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid') ?? ''))
  return ids.map((id) => id.replace('hmi-outline-', ''))
}

/** An element's box on the page, selected through the Layers tab. */
async function boxOf(page: Page, name: string): Promise<{ x: number; y: number; width: number; height: number }> {
  await pickLayer(page, name)
  const box = await page.getByTestId(`hmi-selected-${name}`).boundingBox()
  if (!box) throw new Error(`${name} is not on the canvas`)
  return box
}

/** A container's box fills its parent's, within a pixel or two of rounding. */
function expectFills(
  child: { x: number; y: number; width: number; height: number },
  parent: { x: number; y: number; width: number; height: number },
): void {
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(child[key] - parent[key])).toBeLessThanOrEqual(3)
}

/** Drops a palette widget at a page point over the canvas, then waits for it to be selected. */
async function dropAt(page: Page, widget: string, at: { x: number; y: number }, added: string): Promise<void> {
  const canvas = await page.getByTestId('hmi-canvas-overlay').boundingBox()
  if (!canvas) throw new Error('no canvas')
  await page.getByTestId('hmi-palette-tab-widgets').click()
  await htmlDrag(page, `hmi-palette-${widget}`, at.x - canvas.x, at.y - canvas.y)
  await expect(page.getByTestId(`hmi-selected-${added}`)).toBeVisible({ timeout: 10000 })
  await ready(page)
}

/** Adds a palette widget into a container picked in the Layers tab, then waits for the rebuilt preview. */
async function addInto(page: Page, parent: string, widget: string, added: string): Promise<void> {
  await pickLayer(page, parent)
  const built = await status(page)
  await page.getByTestId('hmi-palette-tab-widgets').click()
  await page.getByTestId(`hmi-palette-${widget}`).dblclick()
  await expect(page.getByTestId(`hmi-selected-${added}`)).toBeVisible({ timeout: 10000 })
  await waitFor(
    page,
    `the preview with ${added}`,
    async () => {
      const now = await status(page)
      return now.startsWith('ready') && now !== built
    },
    60000,
  )
}

/** Drops a palette widget at a canvas point and expects the refusal notice, with the layers unchanged. */
async function refusedAt(page: Page, widget: string, x: number, y: number, shot: string): Promise<void> {
  const before = await layers(page)
  await page.getByTestId('hmi-palette-tab-widgets').click()
  await htmlDrag(page, `hmi-palette-${widget}`, x, y)
  const notice = page.getByTestId('hmi-placement-notice')
  await expect(notice).toHaveAttribute('data-visible', 'true')
  await expect(notice).toHaveText(NOTICE)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(F.shots, shot) })
  expect(await layers(page)).toEqual(before)
  await expect(notice).toHaveAttribute('data-visible', 'false', { timeout: 6000 })
}

test.describe('HMI layout containers', () => {
  test.setTimeout(240000)

  test('a new screen holds a stack; stacks nest side by side; drops outside containers are refused', async () => {
    writeHmiFixture(F, { main: MAIN, screens: { Start: START }, startScreen: 'Start' })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Start').count()) > 0)

      await page.locator('#create-plc-element-trigger').click()
      await page.locator('#create-hmi-screen-trigger').hover()
      await page.locator('#hmi-name').fill('Layout')
      await page.locator('#create-hmi-screen-content').getByRole('button', { name: 'Create' }).click()
      await waitFor(page, 'the Layout leaf', async () => (await leaf(page, 'Layout').count()) > 0)
      await leaf(page, 'Layout').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible({ timeout: 15000 })
      await ready(page)

      expect(await layers(page)).toEqual(['HorizontalStack1'])
      await expect(page.getByTestId('hmi-outline-HorizontalStack1')).toContainText('HorizontalStack')
      const canvas = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      const stack = await boxOf(page, 'HorizontalStack1')
      if (!canvas) throw new Error('no canvas')
      expect(stack.width).toBeGreaterThan(canvas.width * 0.9)
      expect(stack.height).toBeGreaterThan(canvas.height * 0.9)

      await page.getByTestId('hmi-palette-tab-widgets').click()
      await expect(page.getByTestId('hmi-palette-HmiVerticalStack')).toBeVisible()
      await expect(page.getByTestId('hmi-palette-HmiHorizontalStack')).toBeVisible()
      await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, '01-palette-containers.png') })
      await expect(page.getByTestId('hmi-palette-HmiVerticalStack')).toHaveText('Vertical stack')
      await expect(page.getByTestId('hmi-palette-HmiHorizontalStack')).toHaveText('Horizontal stack')

      await dropAt(page, 'HmiVerticalStack', { x: stack.x + stack.width / 2, y: stack.y + 20 }, 'VerticalStack1')
      const split = await boxOf(page, 'VerticalStack1')
      expectFills(split, stack)
      await dropAt(page, 'HmiTank', { x: split.x + split.width / 2, y: split.y + split.height / 2 }, 'Tank1')
      const row = await boxOf(page, 'VerticalStack1')
      await dropAt(
        page,
        'HmiHorizontalStack',
        { x: row.x + row.width - 4, y: row.y + row.height / 2 },
        'HorizontalStack2',
      )
      const side = await boxOf(page, 'HorizontalStack2')
      await dropAt(page, 'HmiButton', { x: side.x + side.width / 2, y: side.y + side.height / 2 }, 'Button1')
      const sideWithOne = await boxOf(page, 'HorizontalStack2')
      await dropAt(
        page,
        'HmiButton',
        { x: sideWithOne.x + sideWithOne.width / 2, y: sideWithOne.y + sideWithOne.height - 4 },
        'Button2',
      )
      const sideWithTwo = await boxOf(page, 'HorizontalStack2')
      await dropAt(
        page,
        'HmiLamp',
        { x: sideWithTwo.x + sideWithTwo.width / 2, y: sideWithTwo.y + sideWithTwo.height - 4 },
        'Lamp1',
      )

      expect(await layers(page)).toEqual([
        'HorizontalStack1',
        'VerticalStack1',
        'Tank1',
        'HorizontalStack2',
        'Button1',
        'Button2',
        'Lamp1',
      ])
      const tank = await boxOf(page, 'Tank1')
      const buttons = await boxOf(page, 'HorizontalStack2')
      const first = await boxOf(page, 'Button1')
      const second = await boxOf(page, 'Button2')
      expect(tank.x + tank.width).toBeLessThanOrEqual(buttons.x + 1)
      expect(Math.abs(tank.y - buttons.y)).toBeLessThanOrEqual(2)
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1)
      expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1)
      expect(first.x).toBeGreaterThanOrEqual(buttons.x - 1)
      await page.getByTestId('hmi-palette-tab-layers').click()
      await page.getByTestId('hmi-canvas-overlay').click({ position: { x: 2, y: 2 } })
      await page.screenshot({ path: join(F.shots, '02-tank-beside-buttons.png') })
      await page.getByTestId('hmi-canvas').screenshot({ path: join(F.shots, '03-tank-beside-buttons-canvas.png') })

      const filledSide = await boxOf(page, 'HorizontalStack2')
      const band = { x: filledSide.x + 4, y: filledSide.y + filledSide.height / 2 }
      const overlay = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      if (!overlay) throw new Error('no canvas')
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await htmlDragOver(page, 'hmi-palette-HmiLamp', band.x - overlay.x, band.y - overlay.y)
      const bar = page.getByTestId('hmi-drop-line')
      await expect(bar).toBeVisible()
      const barBox = await bar.boundingBox()
      if (!barBox) throw new Error('no insertion bar')
      expect(barBox.x).toBeLessThan(filledSide.x + 2)
      expect(barBox.height).toBeGreaterThan(filledSide.height * 0.8)
      await page.screenshot({ path: join(F.shots, '03b-edge-band-mid-drag.png') })
      await dropAt(page, 'HmiLamp', band, 'Lamp2')
      expect(await layers(page)).toEqual([
        'HorizontalStack1',
        'VerticalStack1',
        'Tank1',
        'Lamp2',
        'HorizontalStack2',
        'Button1',
        'Button2',
        'Lamp1',
      ])
      const depth = async (name: string) =>
        page.getByTestId(`hmi-outline-${name}`).evaluate((item) => getComputedStyle(item).paddingLeft)
      expect(await depth('Lamp2')).toBe(await depth('Tank1'))
      const lamp = await boxOf(page, 'Lamp2')
      const sideAfter = await boxOf(page, 'HorizontalStack2')
      const tankAfter = await boxOf(page, 'Tank1')
      expect(lamp.x).toBeGreaterThanOrEqual(tankAfter.x + tankAfter.width - 1)
      expect(lamp.x + lamp.width).toBeLessThanOrEqual(sideAfter.x + 1)
      await page.screenshot({ path: join(F.shots, '03c-edge-band-dropped.png') })

      await page.getByTestId('hmi-palette-tab-layers').click()
      await page.getByTestId('hmi-outline-toggle-VerticalStack1').click()
      await expect(page.getByTestId('hmi-outline-toggle-VerticalStack1')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('hmi-outline-Tank1')).toHaveCount(0)
      await expect(page.getByTestId('hmi-outline-toggle-Tank1')).toHaveCount(0)
      await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, '03d-layers-collapsed.png') })
      await page.getByTestId('hmi-canvas-overlay').click({ position: { x: 2, y: 2 } })
      await page.mouse.click(tankAfter.x + tankAfter.width / 2, tankAfter.y + tankAfter.height / 3)
      await expect(page.getByTestId('hmi-selected-Tank1')).toBeVisible()
      await expect(page.getByTestId('hmi-outline-Tank1')).toBeVisible()
      await expect(page.getByTestId('hmi-outline-toggle-VerticalStack1')).toHaveAttribute('aria-expanded', 'true')
      await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, '03e-layers-revealed.png') })

      await refusedAt(page, 'HmiLamp', 3, 3, '04-refused-outside.png')

      await pickLayer(page, 'HorizontalStack1')
      const built = await status(page)
      await page.getByTestId('hmi-canvas-overlay').focus()
      await page.keyboard.press('Delete')
      await waitFor(page, 'the empty screen', async () => (await layers(page)).length === 0)
      await waitFor(
        page,
        'the empty screen built',
        async () => {
          const now = await status(page)
          return now.startsWith('ready') && now !== built
        },
        60000,
      )
      const empty = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      if (!empty) throw new Error('no canvas')
      await refusedAt(page, 'HmiLamp', empty.width / 2, empty.height / 2, '05-refused-empty-screen.png')

      await page.getByTestId('hmi-palette-tab-widgets').click()
      await htmlDrag(page, 'hmi-palette-HmiVerticalStack', empty.width / 2, empty.height / 2)
      await expect(page.getByTestId('hmi-selected-VerticalStack1')).toBeVisible({ timeout: 10000 })
      expect(await layers(page)).toEqual(['VerticalStack1'])
      await ready(page)
      const root = await boxOf(page, 'VerticalStack1')
      expect(root.width).toBeGreaterThan(empty.width * 0.9)
      expect(root.height).toBeGreaterThan(empty.height * 0.9)
      const overlayNow = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      if (!overlayNow) throw new Error('no canvas')
      await refusedAt(
        page,
        'HmiLamp',
        root.x - overlayNow.x + root.width / 2,
        root.y - overlayNow.y + 3,
        '05b-refused-root-band.png',
      )

      await dropAt(
        page,
        'HmiHorizontalStack',
        { x: root.x + root.width / 2, y: root.y + root.height / 2 },
        'HorizontalStack1',
      )
      const filled = await boxOf(page, 'HorizontalStack1')
      expectFills(filled, root)
      await addInto(page, 'VerticalStack1', 'HmiHorizontalStack', 'HorizontalStack2')
      const left = await boxOf(page, 'HorizontalStack1')
      const right = await boxOf(page, 'HorizontalStack2')
      expect(await layers(page)).toEqual(['VerticalStack1', 'HorizontalStack1', 'HorizontalStack2'])
      expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(2)
      expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1)
      expect(right.x + right.width - left.x).toBeGreaterThan(root.width * 0.95)
      expect(Math.abs(left.height - root.height)).toBeLessThanOrEqual(3)
      expect(Math.abs(right.height - root.height)).toBeLessThanOrEqual(3)
      await page.screenshot({ path: join(F.shots, '06-two-containers-split.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('a screen whose code puts an element directly on it does not build, naming the element', async () => {
    writeHmiFixture(G, { main: MAIN, screens: { Loose: LOOSE }, startScreen: 'Loose' })
    const { app, page } = await launchHmiApp(G)
    try {
      await page.getByText(G.name, { exact: true }).first().click({ timeout: 30000 })
      await waitForIn(G, page, 'the HMI branch', async () => (await leaf(page, 'Loose').count()) > 0)
      await leaf(page, 'Loose').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible({ timeout: 15000 })
      const errors = page.getByTestId('hmi-errors')
      await expect(errors).toContainText(
        "Loose: Lamp: only containers may sit directly on screen Loose; put Lamp in a vertical stack, horizontal stack or diagram with Parent := '<container name>'",
        { timeout: 60000 },
      )
      await expect(errors).not.toContainText('Side:')
      await page.screenshot({ path: join(G.shots, '07-element-on-screen-refused.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
