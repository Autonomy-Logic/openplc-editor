/**
 * The data widgets in the built app: the palette offers the alarm list only on a board with the hmiDataWidgets
 * capability, a dropped alarm table becomes the list's Source, and a dialog's answer reaches the screen's code in the
 * preview.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { test } from '@playwright/test'

import {
  accentOnStrip,
  hmiFixture,
  htmlDrag,
  launchHmiApp,
  leaf,
  pickLayer,
  previewBuilds,
  save,
  screenOnDisk,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const MAIN = `PROGRAM Main
  VAR
    Alarms : ARRAY[1..4] OF HMI_ALARM_ROW;
    Sys : HMI_ALARM_SUMMARY;
    Answer : INT;
  END_VAR
  HMI_ALARMS(Summary := Sys, Table := Alarms);
END_PROGRAM
`

const PANEL = `FUNCTION_BLOCK Panel EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 12, Padding := 16);
    Marker : HmiRect := (Parent := 'Col', PrefWidth := 60, PrefHeight := 40, GrowAuto := FALSE);
    List : HmiAlarmList := (Parent := 'Col', PrefHeight := 200, GrowAuto := FALSE);
    Ask : HmiDialog := (Parent := 'Col', Open := TRUE, Title := 'Start pump?', Buttons := 'No;Yes');
  END_VAR
  IF Ask.Answered THEN
    instance0.Main.Answer := Ask.Result;
  END_IF;
  Marker.Fill := SEL(instance0.Main.Answer = 2, COLOR.Fill, COLOR.Accent);
END_FUNCTION_BLOCK
`

let F = hmiFixture('hmi-data-widgets')

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

/** Whether the preview is ready; fails at once with the designer's errors when its build failed. */
async function previewReady(page: Page): Promise<boolean> {
  const state = await status(page)
  if (state.startsWith('failed'))
    throw new Error(`the preview failed: ${(await page.getByTestId('hmi-errors').allInnerTexts()).join(' | ')}`)
  return state.startsWith('ready')
}

/** How many preview builds of the screen have finished. */
const builds = (page: Page) => previewBuilds(page)

/** Opens the project and the Panel screen, and waits for its preview. */
async function openPanel(page: Page): Promise<void> {
  await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
  await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Panel').count()) > 0)
  await leaf(page, 'Panel').click()
  await waitFor(page, 'the preview', () => previewReady(page), 90000)
}

test.describe('HMI data widgets', () => {
  test.setTimeout(180000)

  test('leaves the alarm list out of the palette on a board without the capability', async () => {
    F = hmiFixture('hmi-data-widgets-simulator')
    writeHmiFixture(F, {
      main: MAIN,
      screens: { Panel: PANEL },
      startScreen: 'Panel',
      deviceBoard: 'OpenPLC Simulator',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await openPanel(page)
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await waitFor(page, 'the alarm banner in the palette', () =>
        page.getByTestId('hmi-palette-HmiAlarmBanner').isVisible(),
      )
      await page.screenshot({ path: join(F.shots, 'palette-simulator.png') })
      if ((await page.getByTestId('hmi-palette-HmiAlarmList').count()) > 0)
        throw new Error('the alarm list is offered on the simulator')
      if ((await page.getByTestId('hmi-palette-HmiEventLog').count()) > 0)
        throw new Error('the event log is offered on the simulator')
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('offers the alarm list on Runtime v4, binds a dropped alarm table, and answers a dialog in the preview', async () => {
    F = hmiFixture('hmi-data-widgets')
    writeHmiFixture(F, { main: MAIN, screens: { Panel: PANEL }, startScreen: 'Panel' })
    const { app, page } = await launchHmiApp(F)
    try {
      await openPanel(page)
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await waitFor(page, 'the alarm list in the palette', () =>
        page.getByTestId('hmi-palette-HmiAlarmList').isVisible(),
      )
      await page.screenshot({ path: join(F.shots, 'palette-v4.png') })

      await pickLayer(page, 'List')
      const list = await page.getByTestId('hmi-selected-List').boundingBox()
      const overlay = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      if (!list || !overlay) throw new Error('the list is not on the canvas')
      await page.getByTestId('hmi-palette-tab-variables').click()
      await waitFor(page, 'the alarm table in the variables', () =>
        page.getByTestId('hmi-variable-instance0.Main.Alarms').isVisible(),
      )
      await htmlDrag(
        page,
        'hmi-variable-instance0.Main.Alarms',
        list.x - overlay.x + list.width / 2,
        list.y - overlay.y + list.height / 2,
      )
      const bound = await builds(page)
      await save(app)
      await waitFor(page, 'the Source on disk', async () =>
        screenOnDisk(F, 'Panel').includes("Source := 'instance0.Main.Alarms'"),
      )
      await waitFor(
        page,
        'the preview rebuilt with the bound list',
        async () => (await builds(page)) > bound && (await previewReady(page)),
        90000,
      )
      await page.screenshot({ path: join(F.shots, 'list-bound.png') })

      await pickLayer(page, 'Marker')
      const marker = await page.getByTestId('hmi-selected-Marker').boundingBox()
      const canvas = await page.locator('[data-testid="hmi-canvas"] canvas').boundingBox()
      if (!marker || !canvas) throw new Error('no marker or canvas')
      const lu = marker.height / 40
      const markerOn = () => accentOnStrip(page, marker.x + marker.width / 2, marker.y, marker.y + marker.height)

      const before = await builds(page)
      await page.getByTestId('hmi-preview-mode').click()
      await waitFor(
        page,
        'the preview rebuilt in preview mode',
        async () => (await builds(page)) > before && (await previewReady(page)),
        90000,
      )
      await waitFor(page, 'the marker off before the answer', async () => !(await markerOn()))
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(F.shots, 'dialog-open.png') })
      /* The 260 x 140 box is centred; Yes, the last button, is 70 x 32 lu, 12 lu in from its right, 14 up from its bottom. */
      const cx = canvas.x + canvas.width / 2
      const cy = canvas.y + canvas.height / 2
      await page.mouse.click(cx + (130 - 12 - 35) * lu, cy + (70 - 14 - 16) * lu)
      await waitFor(page, 'the marker on for Yes', markerOn)
      await page.screenshot({ path: join(F.shots, 'dialog-answered.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
