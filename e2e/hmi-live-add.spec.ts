/**
 * Elements added without a build: a widget dropped from the palette, dropped on a diagram or pasted shows on the
 * running preview at once, while every compile is held back, as on a slow computer; undo takes it off again; once the
 * held build finishes, its module replaces the running one with the same pixels on every frame and the selection
 * kept. The Console carries each build's timing breakdown.
 *
 * Compiles are held by wrapping the main process's `wasm-toolchain:compile` handler. Needs a production build and the
 * preload copy; see "Electron e2e" in CLAUDE.md. Every wait also reads the app's own error text and fails at once when
 * the app reports one.
 */
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { waitForText } from './helpers/app-console'
import {
  hmiFixture,
  launchHmiApp,
  leaf,
  pickLayer,
  propertyField,
  redo,
  status,
  undo,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-live-add')
const G = hmiFixture('hmi-live-edit')

const LAYOUT = `FUNCTION_BLOCK Layout EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 8, Padding := 8);
    Top : HmiVerticalStack := (Parent := 'Col', Gap := 12, GrowAuto := FALSE);
    A : HmiLabel := (Text := 'Alpha', Parent := 'Top');
    B : HmiLabel := (Text := 'Bravo', Parent := 'Top');
    C : HmiLabel := (Text := 'Charlie', Parent := 'Top');
    Bottom : HmiVerticalStack := (Parent := 'Col', Gap := 12, GrowAuto := FALSE);
    D : HmiLabel := (Text := 'Delta', Parent := 'Bottom');
    Plant : HmiDiagram := (Parent := 'Col', DesignW := 400, DesignH := 120);
    Tank : HmiTank := (Parent := 'Plant', X := 20, Y := 10, Caption := 'T1');
  END_VAR
END_FUNCTION_BLOCK
`

const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 8, Padding := 8);
    Title : HmiLabel := (Text := 'Overview', Parent := 'Col');
    Plant : HmiDiagram := (Parent := 'Col', DesignW := 400, DesignH := 160);
    Tank : HmiTank := (Parent := 'Plant', X := 20, Y := 10, Caption := 'T1');
  END_VAR
END_FUNCTION_BLOCK
`
const MAIN = 'PROGRAM Main\n  VAR\n    Level : REAL := 6.5;\n  END_VAR\n  Level := Level;\nEND_PROGRAM\n'
/** How long a dropped widget may take to show; the preview aims well below it on any computer. */
const DRAWN_MS = 100
const CHANNEL = 'wasm-toolchain:compile'

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

/** Holds every compile in the main process until `releaseCompiles`, counting those that finish. */
async function holdCompiles(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, channel) => {
    const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
    const original: unknown = handlers instanceof Map ? handlers.get(channel) : undefined
    if (typeof original !== 'function') throw new Error(`no ${channel} handler to wrap`)
    const gate: { open: () => void; opened: Promise<void>; finished: number } = {
      open: () => undefined,
      opened: Promise.resolve(),
      finished: 0,
    }
    gate.opened = new Promise<void>((resolve) => {
      gate.open = resolve
    })
    Reflect.set(globalThis, '__hmiCompileGate', gate)
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args: unknown[]) => {
      await gate.opened
      try {
        return await Promise.resolve(Reflect.apply(original, undefined, args))
      } finally {
        gate.finished++
      }
    })
  }, CHANNEL)
}

const compilesFinished = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => {
    const gate: unknown = Reflect.get(globalThis, '__hmiCompileGate')
    const finished: unknown = typeof gate === 'object' && gate !== null ? Reflect.get(gate, 'finished') : -1
    return typeof finished === 'number' ? finished : -1
  })

const releaseCompiles = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => {
    const gate: unknown = Reflect.get(globalThis, '__hmiCompileGate')
    const open: unknown = typeof gate === 'object' && gate !== null ? Reflect.get(gate, 'open') : undefined
    if (typeof open === 'function') Reflect.apply(open, undefined, [])
  })

/** A coarse sample of the preview canvas: the green channel of a 320 x 200 copy, as one string. */
const sampleCanvas = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
    const small = document.createElement('canvas')
    small.width = 320
    small.height = 200
    const scaled = small.getContext('2d', { willReadFrequently: true })
    if (!canvas || !scaled) throw new Error('no preview canvas')
    scaled.drawImage(canvas, 0, 0, 320, 200)
    const data = scaled.getImageData(0, 0, 320, 200).data
    const out: number[] = []
    for (let i = 0; i < data.length; i += 4) out.push(data[i + 1])
    return out.join(',')
  })

/**
 * Drops a palette widget on the canvas, then waits frame by frame until the canvas changed and the new element is
 * outlined as selected; returns how long that took in ms, or -1 after `limitMs`.
 */
const dropAndTime = (page: Page, widget: string, x: number, y: number, outline: string, limitMs: number) =>
  page.evaluate(
    async ({ widget, x, y, outline, limitMs }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
      const context = canvas?.getContext('2d')
      const from = document.querySelector(`[data-testid="hmi-palette-${widget}"]`)
      const to = document.querySelector('[data-testid="hmi-canvas-overlay"]')
      if (!canvas || !context || !from || !to) throw new Error(`cannot drop ${widget}`)
      const small = document.createElement('canvas')
      small.width = 320
      small.height = 200
      const scaled = small.getContext('2d', { willReadFrequently: true })
      const read = (from: HTMLCanvasElement): Uint8ClampedArray => {
        if (!scaled) throw new Error('no 2D context')
        scaled.clearRect(0, 0, 320, 200)
        scaled.drawImage(from, 0, 0, 320, 200)
        return scaled.getImageData(0, 0, 320, 200).data
      }
      const pixels = () => read(canvas)
      const before = pixels()
      const rect = to.getBoundingClientRect()
      const at = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true }
      const dataTransfer = new DataTransfer()
      const start = performance.now()
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }))
      to.dispatchEvent(new DragEvent('dragenter', { ...at, dataTransfer }))
      to.dispatchEvent(new DragEvent('dragover', { ...at, dataTransfer }))
      to.dispatchEvent(new DragEvent('drop', { ...at, dataTransfer }))
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer, bubbles: true }))
      for (;;) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const elapsed = performance.now() - start
        const outlined = document.querySelector(`[data-testid="hmi-selected-${outline}"]`) !== null
        const now = pixels()
        if (outlined && now.some((v, i) => v !== before[i])) return elapsed
        if (elapsed > limitMs) return -1
      }
    },
    { widget, x, y, outline, limitMs },
  )

/**
 * Samples the canvas on every animation frame until the preview reports a finished build other than `opened`, and
 * 500 ms longer, and counts the samples that differ from `expected`.
 */
const watchCanvasThroughBuild = (page: Page, expected: string, opened: string) =>
  page.evaluate(
    async ({ expected, opened }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
      const context = canvas?.getContext('2d')
      if (!canvas || !context) throw new Error('no preview canvas')
      const small = document.createElement('canvas')
      small.width = 320
      small.height = 200
      const scaled = small.getContext('2d', { willReadFrequently: true })
      const read = (from: HTMLCanvasElement): Uint8ClampedArray => {
        if (!scaled) throw new Error('no 2D context')
        scaled.clearRect(0, 0, 320, 200)
        scaled.drawImage(from, 0, 0, 320, 200)
        return scaled.getImageData(0, 0, 320, 200).data
      }
      const state = () => document.querySelector('[data-testid="hmi-canvas-area"]')?.getAttribute('data-preview') ?? ''
      let frames = 0
      let differing = 0
      let end = performance.now() + 60000
      let replaced = false
      while (performance.now() < end) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const data = read(canvas)
        const out: number[] = []
        for (let i = 0; i < data.length; i += 4) out.push(data[i + 1])
        frames++
        if (out.join(',') !== expected) differing++
        if (!replaced && /^ready \d+$/.test(state()) && state() !== opened) {
          replaced = true
          end = performance.now() + 500
        }
      }
      return { frames, differing, replaced }
    },
    { expected, opened },
  )

/** Where an element sits on the canvas overlay, from its selection outline. */
async function boxIn(page: Page, element: string) {
  const box = await page.getByTestId(`hmi-selected-${element}`).boundingBox()
  const overlay = await page.getByTestId('hmi-canvas-overlay').boundingBox()
  if (!box || !overlay) throw new Error(`${element} is not on the canvas`)
  return { x: box.x - overlay.x, y: box.y - overlay.y, width: box.width, height: box.height }
}

test.describe('HMI live elements', () => {
  test.setTimeout(180000)

  test('shows dropped and pasted widgets before their build, then keeps them through it', async () => {
    writeHmiFixture(F, { main: MAIN, screens: { Overview: OVERVIEW }, startScreen: 'Overview' })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText('hmi-live-add', { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Overview').count()) > 0)
      await leaf(page, 'Overview').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible({ timeout: 15000 })
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)
      await page.getByRole('tab', { name: 'Console' }).click()
      await waitForText(
        page,
        /HMI preview built in \d+ ms: files \d+, generate \d+ .*toolchain \d+ .*first frame \d+/,
        {
          timeout: 20000,
        },
      )
      const opened = await status(page)

      await holdCompiles(app)
      await pickLayer(page, 'Col')
      const col = await boxIn(page, 'Col')
      await page.getByTestId('hmi-palette-tab-widgets').click()
      const beforeDrop = await sampleCanvas(page)
      const dropMs = await dropAndTime(page, 'HmiLamp', col.x + col.width / 2, col.y + col.height - 12, 'Lamp1', 2000)
      console.log(`a dropped lamp was drawn ${dropMs.toFixed(1)} ms after the drop`)
      await page.screenshot({ path: join(F.shots, '01-dropped-while-compiles-held.png') })
      expect(dropMs, 'the lamp is drawn before any compile finishes').toBeGreaterThan(0)
      expect(dropMs).toBeLessThan(DRAWN_MS)
      expect(await compilesFinished(app)).toBe(0)
      expect(await status(page)).toMatch(new RegExp(`^(ready|building) ${opened.split(' ')[1]}$`))

      await undo(app)
      await waitFor(page, 'the undone lamp to go', async () => (await sampleCanvas(page)) === beforeDrop, 5000)
      await expect(page.getByTestId('hmi-selected-Lamp1')).toHaveCount(0)
      expect(await compilesFinished(app)).toBe(0)

      await waitFor(page, 'a build to start and wait for the toolchain', async () =>
        (await status(page)).startsWith('building'),
      )
      await pickLayer(page, 'Plant')
      const plant = await boxIn(page, 'Plant')
      await page.getByTestId('hmi-palette-tab-widgets').click()
      const diagramMs = await dropAndTime(
        page,
        'HmiLamp',
        plant.x + plant.width * 0.7,
        plant.y + plant.height * 0.6,
        'Lamp1',
        2000,
      )
      console.log(`a lamp dropped on the diagram was drawn ${diagramMs.toFixed(1)} ms after the drop`)
      expect(diagramMs).toBeGreaterThan(0)
      expect(diagramMs).toBeLessThan(DRAWN_MS)

      await pickLayer(page, 'Title')
      await page.getByTestId('hmi-canvas-overlay').focus()
      const command = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.press(`${command}+c`)
      await page.keyboard.press(`${command}+v`)
      await waitFor(
        page,
        'the pasted label',
        async () =>
          (await page.locator('[data-testid^="hmi-selected-"]:not([data-testid="hmi-selected-Title"])').count()) > 0,
        2000,
      )
      const pasted = (await page.locator('[data-testid^="hmi-selected-"]').getAttribute('data-testid'))?.slice(
        'hmi-selected-'.length,
      )
      expect(pasted).toBeTruthy()
      expect(await compilesFinished(app)).toBe(0)
      await page.screenshot({ path: join(F.shots, '02-pasted-while-compiles-held.png') })

      const held = await sampleCanvas(page)
      const outlined = await boxIn(page, pasted ?? '')
      await releaseCompiles(app)
      const watching = watchCanvasThroughBuild(page, held, opened)
      const { frames, differing, replaced } = await watching
      console.log(`${frames} frames sampled while the build replaced the module, ${differing} differed`)
      expect(replaced, 'the held build replaced the module').toBe(true)
      expect(await compilesFinished(app)).toBeGreaterThan(0)
      expect(frames).toBeGreaterThan(10)
      expect(differing, 'no frame flickers while the module is replaced').toBe(0)
      expect(await sampleCanvas(page)).toBe(held)
      expect(await boxIn(page, pasted ?? '')).toEqual(outlined)
      await page.getByTestId('hmi-palette-tab-layers').click()
      await expect(page.getByTestId('hmi-outline-Lamp1')).toBeVisible()
      await expect(page.getByTestId(`hmi-outline-${pasted}`)).toBeVisible()
      await page.screenshot({ path: join(F.shots, '03-after-the-build.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('removes, moves and edits widgets live, undo and redo too, and shows progress only for edits that wait', async () => {
    writeHmiFixture(G, { main: MAIN, screens: { Layout: LAYOUT }, startScreen: 'Layout' })
    const { app, page } = await launchHmiApp(G)
    const wait = (what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
      waitForIn(G, page, what, check, timeoutMs)
    try {
      await page.getByText('hmi-live-edit', { exact: true }).first().click({ timeout: 30000 })
      await wait('the HMI branch', async () => (await leaf(page, 'Layout').count()) > 0)
      await leaf(page, 'Layout').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible({ timeout: 15000 })
      await wait('the preview', async () => (await status(page)).startsWith('ready'), 60000)
      await holdCompiles(app)
      await page.evaluate(() => {
        const seen: string[] = []
        Reflect.set(window, '__hmiProgressSeen', seen)
        const note = () => {
          const bar = document.querySelector('[data-testid="hmi-preview-loading"]')
          if (bar) seen.push(`${bar.getAttribute('data-dimmed')}:${bar.getAttribute('data-step')}:${performance.now()}`)
        }
        new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true })
      })
      const progressSeen = () =>
        page.evaluate(() => {
          const seen: unknown = Reflect.get(window, '__hmiProgressSeen')
          return Array.isArray(seen) ? seen.map(String) : []
        })

      /**
       * Runs `act` and returns how long after its last key or pointer release (or, for a menu command, after it was
       * sent) the canvas changed, in ms.
       */
      const timed = async (act: () => Promise<void>, command: boolean): Promise<number> => {
        await page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
          const context = canvas?.getContext('2d')
          if (!canvas || !context) throw new Error('no preview canvas')
          const small = document.createElement('canvas')
          small.width = 320
          small.height = 200
          const scaled = small.getContext('2d', { willReadFrequently: true })
          const read = (from: HTMLCanvasElement): Uint8ClampedArray => {
            if (!scaled) throw new Error('no 2D context')
            scaled.clearRect(0, 0, 320, 200)
            scaled.drawImage(from, 0, 0, 320, 200)
            return scaled.getImageData(0, 0, 320, 200).data
          }
          const before = read(canvas)
          const marks = { input: 0, changed: 0 }
          const mark = () => {
            marks.input = performance.now()
          }
          for (const type of ['keydown', 'pointerup', 'change']) window.addEventListener(type, mark, { capture: true })
          Reflect.set(window, '__hmiMarks', marks)
          const watch = () => {
            const shown = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
            const now = shown ? read(shown) : before
            if (shown !== canvas) Reflect.set(window, '__hmiCanvasReplaced', true)
            if (marks.input > 0 && now.some((v, i) => v !== before[i])) {
              marks.changed = performance.now()
              return
            }
            requestAnimationFrame(watch)
          }
          requestAnimationFrame(watch)
        })
        if (command)
          await page.evaluate(() => {
            const marks: unknown = Reflect.get(window, '__hmiMarks')
            if (typeof marks === 'object' && marks !== null) Reflect.set(marks, 'input', performance.now())
          })
        await act()
        await wait(
          'the canvas to change',
          async () => {
            if (await page.evaluate(() => Reflect.get(window, '__hmiCanvasReplaced') === true))
              throw new Error('the preview canvas was replaced')
            return page.evaluate(() => {
              const marks: unknown = Reflect.get(window, '__hmiMarks')
              return typeof marks === 'object' && marks !== null && Number(Reflect.get(marks, 'changed')) > 0
            })
          },
          5000,
        )
        return page.evaluate(() => {
          const marks: unknown = Reflect.get(window, '__hmiMarks')
          return typeof marks === 'object' && marks !== null
            ? Number(Reflect.get(marks, 'changed')) - Number(Reflect.get(marks, 'input'))
            : -1
        })
      }
      const rows: string[] = []
      const step = async (what: string, act: () => Promise<void>, expected?: string) => {
        const ms = await timed(act, what.startsWith('undo') || what.startsWith('redo'))
        rows.push(`${what} ${ms.toFixed(1)} ms`)
        expect(ms, `${what} is drawn at once`).toBeLessThan(DRAWN_MS)
        expect(await compilesFinished(app)).toBe(0)
        if (expected !== undefined)
          await wait(`${what} to show the earlier frame`, async () => (await sampleCanvas(page)) === expected, 3000)
      }
      const overlay = page.getByTestId('hmi-canvas-overlay')
      const command = process.platform === 'darwin' ? 'Meta' : 'Control'
      const original = await sampleCanvas(page)

      await pickLayer(page, 'B')
      await overlay.focus()
      await step('remove', () => page.keyboard.press('Delete'))
      const removed = await sampleCanvas(page)
      await expect(page.getByTestId('hmi-outline-B')).toHaveCount(0)
      await step('undo remove', () => undo(app), original)
      await step('redo remove', () => redo(app), removed)
      await step('undo again', () => undo(app), original)
      await page.screenshot({ path: join(G.shots, '01-removed-and-undone.png') })

      await pickLayer(page, 'C')
      await step('reorder to an earlier place', () => page.getByTestId('hmi-outline-C').press('Alt+ArrowUp'))
      const earlier = await sampleCanvas(page)
      await step('undo reorder', () => undo(app), original)
      await step('redo reorder', () => redo(app), earlier)
      await step('undo reorder again', () => undo(app), original)
      await pickLayer(page, 'A')
      await step('reorder to a later place', () => page.getByTestId('hmi-outline-A').press('Alt+ArrowDown'))
      await step('undo later reorder', () => undo(app), original)

      await pickLayer(page, 'D')
      const d = await boxIn(page, 'D')
      await pickLayer(page, 'Top')
      const top = await boxIn(page, 'Top')
      const origin = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      if (!origin) throw new Error('no canvas')
      await pickLayer(page, 'D')
      await step('move to another stack', async () => {
        await page.mouse.move(origin.x + d.x + d.width / 2, origin.y + d.y + d.height / 2)
        await page.mouse.down()
        await page.mouse.move(origin.x + top.x + top.width / 2, origin.y + top.y + top.height - 6, { steps: 8 })
        await page.mouse.up()
      })
      const moved = await sampleCanvas(page)
      await page.getByTestId('hmi-palette-tab-layers').click()
      await page.screenshot({ path: join(G.shots, '02-moved-to-another-stack.png') })
      await step('undo move', () => undo(app), original)
      await step('redo move', () => redo(app), moved)
      await step('undo move again', () => undo(app), original)

      await pickLayer(page, 'Tank')
      const tank = await boxIn(page, 'Tank')
      await step('move on the diagram', async () => {
        await page.mouse.move(origin.x + tank.x + tank.width / 2, origin.y + tank.y + tank.height / 2)
        await page.mouse.down()
        await page.mouse.move(origin.x + tank.x + tank.width / 2 + 60, origin.y + tank.y + tank.height / 2, {
          steps: 6,
        })
        await page.mouse.up()
      })
      await step('undo diagram move', () => undo(app), original)

      await pickLayer(page, 'A')
      const text = await propertyField(page, 'Text')
      await text.fill('Alpha two')
      await step('edit a property', () => text.press('Enter'))
      const edited = await sampleCanvas(page)
      await step('undo property edit', () => undo(app), original)
      await step('redo property edit', () => redo(app), edited)
      await step('undo property edit again', () => undo(app), original)
      console.log(`live steps with compiles held: ${rows.join('; ')}`)
      expect(await progressSeen(), 'live edits never show build progress').toEqual([])

      const edit = Date.now()
      await page.getByTestId('hmi-theme').click()
      await page.getByRole('option', { name: 'Theme: Dark' }).click()
      await wait('the build progress over the last frame', async () => (await progressSeen()).length > 0, 5000)
      const shownAfter = Date.now() - edit
      const bar = page.getByTestId('hmi-preview-loading')
      await expect(bar).toHaveAttribute('data-dimmed', 'true')
      await page.screenshot({ path: join(G.shots, '03-waiting-for-a-build.png') })
      expect(shownAfter, 'the progress waits before it shows').toBeGreaterThanOrEqual(250)
      const opened = await status(page)
      await releaseCompiles(app)
      await wait('the build to end', async () => (await bar.count()) === 0, 60000)
      expect(await sampleCanvas(page)).not.toBe(original)
      const steps = (await progressSeen()).map((x) => x.split(':')[1])
      console.log(`build steps the progress showed: ${[...new Set(steps)].join(', ')}; ${opened}`)
      expect(steps).toContain('compile')
      expect(steps.indexOf('start')).toBeGreaterThan(steps.indexOf('compile') - 1)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
