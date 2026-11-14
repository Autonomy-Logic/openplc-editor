/**
 * Process diagrams in the HMI designer, in the built app (TC03): a pipe is drawn by dragging from one vessel's port to
 * another's, gets two bends that make it cross a pipe declared before it, and is drawn with a hop there; symbols are
 * placed on the diagram's grid by dragging; deleting a symbol deletes its pipes.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  centre,
  hmiFixture,
  launchHmiApp,
  leaf,
  pickLayer,
  save,
  screenOnDisk,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-diagram')

const PLANT = `FUNCTION_BLOCK Plant EXTENDS HmiScreen
  VAR
    Area : HmiDiagram := (DesignW := 600, DesignH := 360, Grid := 10, Grow := 1, GrowAuto := FALSE);
    T1 : HmiVessel := (Parent := 'Area', Caption := 'T-1', X := 40, Y := 60, PrefWidth := 80, PrefHeight := 120);
    T2 : HmiVessel := (Parent := 'Area', Caption := 'T-2', X := 480, Y := 60, PrefWidth := 80, PrefHeight := 120);
    Ft : HmiReadout := (Parent := 'Area', Caption := 'FT', X := 260, Y := 10);
    Pm : HmiPump := (Parent := 'Area', X := 276, Y := 290, PrefWidth := 48, PrefHeight := 48);
    Feed : HmiPipe := (Parent := 'Area', Source := 'Ft', SourcePort := HMI_PORT#Bottom, Target := 'Pm', TargetPort := HMI_PORT#Top);
  END_VAR
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)
const plantOnDisk = () => screenOnDisk(F, 'Plant')

/** Presses at `from`, moves to `to` in steps and releases there. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

test.describe('HMI diagram', () => {
  test.setTimeout(180000)

  test('draws pipes between ports with bends and hops, places symbols on the grid (TC03)', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Flow : BOOL;\n  END_VAR\n  Flow := Flow;\nEND_PROGRAM\n',
      screens: { Plant: PLANT },
      startScreen: 'Plant',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Plant').count()) > 0)
      await leaf(page, 'Plant').click()
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)

      await pickLayer(page, 'T1')
      const from = await centre(page, 'hmi-port-T1-1')
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x + 40, from.y, { steps: 4 })
      const to = await centre(page, 'hmi-port-T2-3')
      await page.mouse.move(to.x, to.y, { steps: 4 })
      await page.mouse.up()
      await expect(page.getByTestId('hmi-selected-Pipe1')).toBeVisible({ timeout: 10000 })
      await waitFor(page, 'the preview with the pipe', async () => (await status(page)).startsWith('ready'))

      const pipe = await page.getByTestId('hmi-selected-Pipe1').boundingBox()
      if (!pipe) throw new Error('the pipe is not on the canvas')
      const y = pipe.y + pipe.height / 2
      await page.mouse.dblclick(pipe.x + pipe.width * 0.3, y)
      await expect(page.getByTestId('hmi-bend-0')).toBeVisible({ timeout: 10000 })
      await page.mouse.dblclick(pipe.x + pipe.width * 0.7, y)
      await expect(page.getByTestId('hmi-bend-1')).toBeVisible({ timeout: 10000 })
      for (const bend of ['hmi-bend-0', 'hmi-bend-1']) {
        const at = await centre(page, bend)
        await drag(page, at, { x: at.x, y: at.y + 80 })
      }
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(F.shots, 'tc03-bends.png') })

      await pickLayer(page, 'T2')
      const vessel = await centre(page, 'hmi-selected-T2')
      await drag(page, vessel, { x: vessel.x - 25, y: vessel.y })
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(F.shots, 'tc03-diagram.png') })

      await save(app)
      await waitFor(page, 'the saved diagram', async () => plantOnDisk().includes('Pipe1'))
      const saved = plantOnDisk()
      expect(saved).toContain(
        "Pipe1 : HmiPipe := (Parent := 'Area', Source := 'T1', SourcePort := HMI_PORT#Right, Target := 'T2', TargetPort := HMI_PORT#Left, Path := '",
      )
      const path = /Pipe1 : HmiPipe := \([^)]*Path := '([^']*)'/.exec(saved)?.[1] ?? ''
      const bends = path.split(';').map((p) => p.split(',').map(Number))
      expect(bends).toHaveLength(2)
      expect(bends[0][1]).toBe(bends[1][1])
      expect(bends[0][0]).toBeLessThan(bends[1][0])
      expect(bends[0][1]).toBeGreaterThan(120)
      expect(bends.flat().every((v) => v % 10 === 0)).toBe(true)
      const t2x = Number(/T2 : HmiVessel := \([^)]*X := (\d+)/.exec(saved)?.[1])
      expect(t2x).toBeLessThan(480)
      expect(t2x % 10).toBe(0)

      await pickLayer(page, 'T1')
      await page.getByTestId('hmi-canvas-overlay').press('Delete')
      await expect(page.getByTestId('hmi-outline-Pipe1')).toHaveCount(0, { timeout: 10000 })
      await expect(page.getByTestId('hmi-outline-Feed')).toBeVisible()
      await save(app)
      await waitFor(page, 'the deletion on disk', async () => !plantOnDisk().includes('T1 :'))
      expect(plantOnDisk()).not.toContain('Pipe1')
      expect(plantOnDisk()).toContain('Feed : HmiPipe')
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
