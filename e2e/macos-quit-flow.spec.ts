/**
 * DOPE-662 - macOS quit and close flow, on a production build.
 *
 * `app.quit()` from main is what Cmd+Q, the app menu Quit and the Dock Quit all
 * call; `BrowserWindow.close()` is what the red traffic-light button does.
 * Needs the build + preload copy described under "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

test.skip(process.platform !== 'darwin', 'macOS quit flow')

const ROOT = join(tmpdir(), 'openplc-e2e-macos-quit-flow')
const QUIT_PROMPT = 'Are you sure you want to quit the application?'
const SAVE_PROMPT = /There are unsaved changes in your/

let app: ElectronApplication
let page: Page
let exited: Promise<void>
let hasExited = false

async function findMainWindow(): Promise<Page> {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) return w
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

/** Whether main reports the editor window as on screen. `null` once it is gone. */
function windowVisible(): Promise<boolean | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'),
    )
    return win ? win.isVisible() : null
  })
}

async function expectWindowVisible(visible: boolean): Promise<void> {
  await expect.poll(windowVisible, { timeout: 10000 }).toBe(visible)
}

/** Cmd+Q, app menu Quit and Dock Quit all end up here. */
async function quit(): Promise<void> {
  await app.evaluate(({ app: electronApp }) => electronApp.quit())
}

/** The red traffic-light button. */
async function clickRedButton(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
      ?.close()
  })
}

async function hideWindow(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
      ?.hide()
  })
  await expectWindowVisible(false)
}

async function clickDockIcon(): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('activate')
  })
}

const quitPrompt = () => page.getByText(QUIT_PROMPT)
const savePrompt = () => page.getByText(SAVE_PROMPT)

async function answerQuitPrompt(answer: 'Yes' | 'No'): Promise<void> {
  await page.getByRole('button', { name: answer, exact: true }).click()
}

/** One visible prompt, in a window that is on screen. */
async function expectQuitPromptOnScreen(): Promise<void> {
  await expect(quitPrompt()).toBeVisible({ timeout: 10000 })
  await expectWindowVisible(true)
}

async function expectNoPrompt(): Promise<void> {
  // Give a wrongly opened modal the time to render before asserting its absence.
  await page.waitForTimeout(1000)
  await expect(quitPrompt()).toHaveCount(0)
  await expect(savePrompt()).toHaveCount(0)
}

async function expectProcessEnds(): Promise<void> {
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('the app did not quit')), 15000)),
  ])
}

async function expectProcessAlive(): Promise<void> {
  await page.waitForTimeout(1500)
  expect(hasExited, 'the app should still be running').toBe(false)
}

function writeProjectFixture(dir: string, userData: string): void {
  mkdirSync(join(dir, 'devices'), { recursive: true })
  mkdirSync(join(dir, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({
      meta: { name: 'macos-quit-flow', type: 'plc-project' },
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
    'utf-8',
  )
  writeFileSync(
    join(dir, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
    'utf-8',
  )
  writeFileSync(join(dir, 'devices', 'pin-mapping.json'), '{}', 'utf-8')
  writeFileSync(
    join(dir, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    counter : INT;\n  END_VAR\n\ncounter := counter + 1;\n\nEND_PROGRAM\n',
    'utf-8',
  )

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'macos-quit-flow',
        path: dir,
        projectFilePath: join(dir, 'project.json'),
        createdAt: now,
        lastOpenedAt: now,
      },
    ]),
    'utf-8',
  )
  writeFileSync(join(history, 'libraries.json'), '[]', 'utf-8')
}

/** Open the fixture and make it unsaved by typing into the ST body. */
async function openProjectWithUnsavedChanges(): Promise<void> {
  await page.getByText('macos-quit-flow', { exact: true }).first().click({ timeout: 30000 })
  await page.getByText('main', { exact: true }).first().click({ timeout: 30000 })
  const body = page.locator('.view-lines:visible').first()
  await body.click()
  await page.keyboard.type('(* unsaved *)')
  await expect(body).toContainText('unsaved', { timeout: 10000 })
}

test.beforeEach(async ({}, testInfo) => {
  test.setTimeout(120000)
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const base = join(ROOT, slug)
  rmSync(base, { recursive: true, force: true })
  const userData = join(base, 'userdata')
  writeProjectFixture(join(base, 'project'), userData)

  app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  hasExited = false
  exited = new Promise((resolve) => {
    app.process().once('exit', () => {
      hasExited = true
      resolve()
    })
  })
  page = await findMainWindow()
  await page.waitForLoadState('domcontentloaded')
  await expectWindowVisible(true)
  await expect(page.getByRole('button', { name: /exit/i })).toBeVisible({ timeout: 30000 })
})

test.afterEach(async () => {
  // The prompt holds every quit, so `app.close()` would hang on a failing run.
  if (!hasExited) app.process().kill('SIGKILL')
  await exited
})

test.describe('Cmd+Q', () => {
  test('shows the quit confirmation on screen; No keeps the app running', async () => {
    await quit()
    await expectQuitPromptOnScreen()

    await answerQuitPrompt('No')

    await expect(quitPrompt()).toHaveCount(0)
    await expectWindowVisible(true)
    await expectProcessAlive()
  })

  test('Yes ends the process in that same action', async () => {
    await quit()
    await expectQuitPromptOnScreen()

    await answerQuitPrompt('Yes')

    await expectProcessEnds()
  })

  test('with the window hidden, brings it forward showing the prompt', async () => {
    await hideWindow()

    await quit()

    await expectQuitPromptOnScreen()
  })

  test('with the window hidden, one quit then Yes ends the process', async () => {
    await hideWindow()
    await quit()
    await expectQuitPromptOnScreen()

    await answerQuitPrompt('Yes')

    await expectProcessEnds()
  })

  test('with the window hidden after the red button, brings it forward showing the prompt', async () => {
    await clickRedButton()
    await expectWindowVisible(false)

    await quit()

    await expectQuitPromptOnScreen()
  })
})

test.describe('start-screen Exit', () => {
  test('prompts on screen on the first click instead of hiding', async () => {
    await page.getByRole('button', { name: /exit/i }).click()

    await expectQuitPromptOnScreen()
  })

  test('Yes ends the process', async () => {
    await page.getByRole('button', { name: /exit/i }).click()
    await expectQuitPromptOnScreen()

    await answerQuitPrompt('Yes')

    await expectProcessEnds()
  })

  test('prompts every time, also after a cancelled quit', async () => {
    await page.getByRole('button', { name: /exit/i }).click()
    await expectQuitPromptOnScreen()
    await answerQuitPrompt('No')

    await page.getByRole('button', { name: /exit/i }).click()

    await expectQuitPromptOnScreen()
  })
})

test.describe('red button', () => {
  test('hides the window and never prompts', async () => {
    await clickRedButton()

    await expectWindowVisible(false)
    await expectNoPrompt()
    await expectProcessAlive()
  })

  test('still only hides after a cancelled quit', async () => {
    await quit()
    await expectQuitPromptOnScreen()
    await answerQuitPrompt('No')

    await clickRedButton()

    await expectWindowVisible(false)
    await expectNoPrompt()
  })

  test('the Dock icon brings the window back', async () => {
    await clickRedButton()
    await expectWindowVisible(false)

    await clickDockIcon()

    await expectWindowVisible(true)
    await expectNoPrompt()
  })
})

test.describe('after cancelled quits', () => {
  test('Cmd+Q, the red button and Exit each behave as on a fresh launch', async () => {
    for (let i = 0; i < 2; i++) {
      await quit()
      await expectQuitPromptOnScreen()
      await answerQuitPrompt('No')
    }

    await clickRedButton()
    await expectWindowVisible(false)
    await expectNoPrompt()

    await clickDockIcon()
    await expectWindowVisible(true)
    await page.getByRole('button', { name: /exit/i }).click()
    await expectQuitPromptOnScreen()
    await answerQuitPrompt('No')

    await quit()
    await expectQuitPromptOnScreen()
  })
})

test.describe('unsaved project', () => {
  test('Cmd+Q shows the save-changes prompt on screen; Cancel keeps the app running', async () => {
    await openProjectWithUnsavedChanges()

    await quit()

    await expect(savePrompt()).toBeVisible({ timeout: 10000 })
    await expectWindowVisible(true)
    await expect(quitPrompt()).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await expect(savePrompt()).toHaveCount(0)
    await expectProcessAlive()
  })

  test('Close without saving ends the process', async () => {
    await openProjectWithUnsavedChanges()
    await quit()
    await expect(savePrompt()).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: /close without saving/i }).click()

    await expectProcessEnds()
  })

  test('with the window hidden, Cmd+Q brings it forward showing the save-changes prompt', async () => {
    await openProjectWithUnsavedChanges()
    await hideWindow()

    await quit()

    await expect(savePrompt()).toBeVisible({ timeout: 10000 })
    await expectWindowVisible(true)
  })

  test('the red button hides without the save-changes prompt', async () => {
    await openProjectWithUnsavedChanges()

    await clickRedButton()

    await expectWindowVisible(false)
    await expectNoPrompt()
  })
})

/** A renderer that cannot show the prompt must not swallow the quit. */
test.describe('renderer unable to prompt', () => {
  test('Cmd+Q ends the process when the renderer has crashed', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
        ?.webContents.forcefullyCrashRenderer()
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.isCrashed()),
        ),
      )
      .toBe(true)

    await quit()

    await expectProcessEnds()
  })

  test('Cmd+Q prompts on screen again after a reload', async () => {
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('button', { name: /exit/i })).toBeVisible({ timeout: 30000 })

    await quit()

    await expectQuitPromptOnScreen()
    await expectProcessAlive()
  })
})
