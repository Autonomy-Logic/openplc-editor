/**
 * User management with the four runtime roles, against a real OpenPLC Runtime v4 in Docker built from an
 * openplc-runtime checkout (e2e/helpers/runtime-container.ts). Skipped when Docker is not available.
 * Needs a production build and the preload copy (CLAUDE.md, "Electron e2e").
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { waitForApp, waitForText } from './helpers/app-console'
import { connectRuntime, launch } from './helpers/ethercat-project'
import { freshRoot, writeProfile } from './helpers/library-project'
import {
  createAccount,
  createFirstAdmin,
  ensureRuntimeImage,
  RUNTIME_HOST,
  rolesOnRuntime,
  runtimeContainerUnavailable,
  runtimeRequest,
  signIn,
  startRuntimeContainer,
  stopRuntimeContainer,
} from './helpers/runtime-container'

const PROJECT_NAME = 'user-roles'
const ADMIN = { username: 'admin', password: 'admin-pass-1' }

test.describe.configure({ mode: 'serial' })

let unavailable: string | null = null
let adminToken = ''

/** A Runtime v4 project pointed at the container, and a profile that lists it. */
function writeRuntimeProject(rootName: string): { project: string; userData: string } {
  const root = freshRoot(rootName)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices'), { recursive: true })
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
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
    join(project, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    count : INT;\n  END_VAR\n\ncount := count + 1;\n\nEND_PROGRAM\n',
  )
  writeFileSync(
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: RUNTIME_HOST,
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeProfile(userData, PROJECT_NAME, project)
  return { project, userData }
}

/** Launches the editor, opens the project and signs in to the runtime as `username`. */
async function openConnected(rootName: string, username: string, password: string) {
  const { userData } = writeRuntimeProject(rootName)
  const { app, page } = await launch(userData)
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
  await connectRuntime(page, username, password)
  return { app, page }
}

async function openUserManagement(page: Page): Promise<void> {
  await page.getByText('User Management', { exact: true }).first().click({ timeout: 30000 })
  await waitForText(page, /Manage the accounts that can log in to this runtime\./, {
    timeout: 30000,
  })
}

function accountRow(page: Page, username: string): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: new RegExp(`^${username}`) }) })
}

/** Hovers the edge of the wrapper an activity bar button's tooltip hangs on, beside the disabled button itself. */
async function hoverTooltipTrigger(page: Page, button: Locator): Promise<void> {
  const trigger = button.locator('xpath=..')
  const box = await trigger.boundingBox()
  if (!box) throw new Error('the tooltip trigger is not visible')
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
}

test.beforeAll(async () => {
  unavailable = runtimeContainerUnavailable()
  test.skip(unavailable !== null, unavailable ?? '')
  test.setTimeout(1800000)
  ensureRuntimeImage()
  await startRuntimeContainer()
  await createFirstAdmin(ADMIN.username, ADMIN.password)
  adminToken = await signIn(ADMIN.username, ADMIN.password)
})

test.afterAll(() => {
  if (unavailable === null) stopRuntimeContainer()
})

test('an admin creates an operator, makes it a viewer, and is told it cannot demote the last admin', async () => {
  test.setTimeout(180000)
  const { app, page } = await openConnected('openplc-e2e-user-roles-admin', ADMIN.username, ADMIN.password)
  try {
    await openUserManagement(page)
    await expect(accountRow(page, 'admin')).toContainText('Admin')

    await page.getByText('New User', { exact: true }).click()
    await expect(page.getByRole('radio', { name: 'Engineer' })).toBeChecked()
    await page.getByPlaceholder('Enter username').fill('line-op')
    await page.getByPlaceholder('Enter password').fill('line-op-pass')
    await page.getByPlaceholder('Confirm password').fill('line-op-pass')
    await page.getByRole('radio', { name: 'Operator' }).check()
    await page.getByRole('button', { name: 'Create user' }).click()
    await expect(accountRow(page, 'line-op')).toContainText('Operator', { timeout: 30000 })
    expect((await rolesOnRuntime(adminToken))['line-op']).toBe('operator')

    await accountRow(page, 'line-op').getByRole('button', { name: 'Edit line-op' }).click()
    await page.getByRole('radio', { name: 'Viewer' }).check()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(accountRow(page, 'line-op')).toContainText('Viewer', { timeout: 30000 })
    expect((await rolesOnRuntime(adminToken))['line-op']).toBe('viewer')

    await accountRow(page, 'admin').getByRole('button', { name: 'Edit admin' }).click()
    await page.getByRole('radio', { name: 'Engineer' }).check()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.getByText('Cannot demote the last remaining admin. Make another account an admin first.'),
    ).toBeVisible({ timeout: 30000 })
    expect((await rolesOnRuntime(adminToken)).admin).toBe('admin')
  } finally {
    app.process().kill('SIGKILL')
  }
})

test('an operator is refused the account list, changes its own password and stays connected', async () => {
  test.setTimeout(180000)
  await createAccount(adminToken, 'hmi-op', 'op-pass-old', 'operator')
  const { app, page } = await openConnected('openplc-e2e-user-roles-operator', 'hmi-op', 'op-pass-old')
  try {
    await openUserManagement(page)
    await expect(page.getByText('The account list is not available to your role (operator).')).toBeVisible({
      timeout: 30000,
    })
    const ownRow = accountRow(page, 'hmi-op')
    await expect(ownRow).toContainText('Operator')
    await expect(page.getByRole('row')).toHaveCount(2)

    await ownRow.getByRole('button', { name: 'Edit hmi-op' }).click()
    await page.getByPlaceholder('Enter password').click()
    await page.getByPlaceholder('Enter password').fill('op-pass-new')
    await page.getByPlaceholder('Confirm password').fill('op-pass-new')
    await page.getByPlaceholder('Enter your current password').fill('op-pass-old')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('You are still signed in.').first()).toBeVisible({ timeout: 30000 })

    await page.getByTitle('Refresh').click()
    await expect(accountRow(page, 'hmi-op')).toContainText('Operator', { timeout: 30000 })
    await page.waitForTimeout(5000)
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toHaveCount(0)
    await expect(page.getByText('Connection to runtime lost')).toHaveCount(0)
    await page.getByText('Configuration', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()

    await signIn('hmi-op', 'op-pass-new')
    expect((await runtimeRequest('POST', '/api/login', { username: 'hmi-op', password: 'op-pass-old' })).status).toBe(
      401,
    )
  } finally {
    app.process().kill('SIGKILL')
  }
})

test("an operator's upload, start/stop and debugger are disabled with the role notice", async () => {
  test.setTimeout(180000)
  await createAccount(adminToken, 'hmi-op2', 'op2-pass', 'operator')
  const { app, page } = await openConnected('openplc-e2e-user-roles-gates', 'hmi-op2', 'op2-pass')
  try {
    const debuggerButton = page.getByRole('button', { name: 'Debugger', exact: true })
    await waitForApp(page, () => debuggerButton.isDisabled(), {
      timeout: 30000,
      message: 'the debugger never became disabled for the operator',
    })
    await hoverTooltipTrigger(page, debuggerButton)
    await expect(page.getByRole('tooltip')).toContainText("Your role (operator) can't use the debugger")

    const playButton = page.getByRole('button', { name: 'Play', exact: true })
    await expect(playButton).toBeDisabled()
    await page.mouse.move(0, 0)
    await hoverTooltipTrigger(page, playButton)
    await expect(page.getByRole('tooltip')).toContainText("Your role (operator) can't start or stop the PLC")

    await page.mouse.move(0, 0)
    await page.getByRole('button', { name: 'Build options' }).click()
    const upload = page.getByRole('button', { name: /^Build and upload/ })
    await expect(upload).toBeDisabled()
    await upload.locator('xpath=..').hover({ position: { x: 2, y: 2 } })
    await expect(page.getByRole('tooltip')).toContainText("Your role (operator) can't upload programs")
    await expect(page.getByRole('button', { name: /^Build only/ })).toBeEnabled()
  } finally {
    app.process().kill('SIGKILL')
  }
})
