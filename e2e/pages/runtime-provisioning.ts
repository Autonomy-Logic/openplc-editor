import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test'

import { launch } from '../helpers/ethercat-project'

export const PROVISIONING_PROJECT = 'provisioning-project'

/** Project folder and user data folder of one isolated editor profile. */
export interface ProvisioningPaths {
  root: string
  project: string
  userData: string
}

/** Writes a Runtime v4 project aimed at @p runtimeIpAddress and a profile that lists it. */
export function writeProvisioningProject(slug: string, runtimeIpAddress: string): ProvisioningPaths {
  const root = join(realpathSync(tmpdir()), 'openplc-e2e-runtime-provisioning', slug)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices'), { recursive: true })
  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: PROVISIONING_PROJECT, type: 'plc-project' },
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
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress,
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(project, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    Count : INT;\n  END_VAR\n\nCount := Count + 1;\n\nEND_PROGRAM\n',
  )
  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROVISIONING_PROJECT,
        path: project,
        projectFilePath: join(project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
  return { root, project, userData }
}

/** The saved SSH host keys file of the profile. */
export function hostKeyFilePath(paths: ProvisioningPaths): string {
  return join(paths.userData, 'ssh-known-hosts.json')
}

/** Every file the editor wrote for this profile and project, read as text, for credential searches. */
export function profileTexts(paths: ProvisioningPaths): string {
  const files = [
    join(paths.userData, 'logs', 'combined.log'),
    hostKeyFilePath(paths),
    join(paths.project, 'project.json'),
    join(paths.project, 'devices', 'configuration.json'),
  ]
  return files
    .map((file) => {
      try {
        return readFileSync(file, 'utf-8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

/** The Device Configuration screen of a Runtime v4 project, with the runtime provisioning dialogs. */
export class RuntimeProvisioningPage {
  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    readonly paths: ProvisioningPaths,
  ) {}

  /** Launches the editor on @p paths, opens the project and its Device Configuration screen. */
  static async open(paths: ProvisioningPaths): Promise<RuntimeProvisioningPage> {
    const { app, page } = await launch(paths.userData)
    const screen = new RuntimeProvisioningPage(app, page, paths)
    await page.getByText(PROVISIONING_PROJECT, { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('Configuration', { exact: true }).first().click({ timeout: 30000 })
    await expect(screen.connectButton).toBeVisible({ timeout: 30000 })
    return screen
  }

  get connectButton(): Locator {
    return this.page.locator('#runtime-connect-button-container > button')
  }

  get connectActivity(): Locator {
    return this.page.getByTestId('device-connect-activity')
  }

  get noDeviceModal(): Locator {
    return this.page.getByTestId('runtime-no-device-modal')
  }

  get noDevicePortInput(): Locator {
    return this.page.getByTestId('runtime-no-device-port-input')
  }

  get noDeviceCheck(): Locator {
    return this.page.getByTestId('runtime-no-device-try-port')
  }

  get dialog(): Locator {
    return this.page.getByTestId('runtime-provisioning-dialog')
  }

  get whatWillBeDone(): Locator {
    return this.page.getByTestId('runtime-provisioning-what-will-be-done')
  }

  get username(): Locator {
    return this.page.getByTestId('runtime-provisioning-username')
  }

  get password(): Locator {
    return this.page.getByTestId('runtime-provisioning-password')
  }

  get sshPort(): Locator {
    return this.page.getByTestId('runtime-provisioning-ssh-port')
  }

  get submit(): Locator {
    return this.page.getByTestId('runtime-provisioning-submit')
  }

  get decline(): Locator {
    return this.page.getByTestId('runtime-provisioning-decline')
  }

  get latestLine(): Locator {
    return this.page.getByTestId('runtime-provisioning-latest-line')
  }

  get elapsed(): Locator {
    return this.page.getByTestId('runtime-provisioning-elapsed')
  }

  get cancel(): Locator {
    return this.page.getByTestId('runtime-provisioning-cancel')
  }

  get hide(): Locator {
    return this.page.getByTestId('runtime-provisioning-hide')
  }

  get lastLines(): Locator {
    return this.page.getByTestId('runtime-provisioning-last-lines')
  }

  get close(): Locator {
    return this.page.getByTestId('runtime-provisioning-close')
  }

  /** A dialog of the editor that is not one of the provisioning dialogs, found by its title. */
  messageDialog(title: string): Locator {
    return this.page.getByRole('dialog').filter({ hasText: title })
  }

  /** A toast found by its title, also while a modal hides it from assistive technology, without its screen-reader copy. */
  toast(title: string): Locator {
    return this.page
      .getByRole('status', { includeHidden: true })
      .filter({ hasText: title })
      .filter({ hasNotText: /^Notification/ })
  }

  /** Presses Connect, then checks @p port from the "No recognized device" modal, reaching the offer. */
  async reachOfferThroughPort(port: number): Promise<void> {
    await this.connectButton.click()
    await expect(this.noDeviceModal).toBeVisible({ timeout: 15000 })
    await this.noDevicePortInput.fill(String(port))
    await this.noDeviceCheck.click()
    await expect(this.dialog).toBeVisible({ timeout: 15000 })
    await expect(this.noDeviceModal).toBeHidden()
  }

  /** Fills the device account and accepts the offer. */
  async submitCredentials(username: string, password: string): Promise<void> {
    await this.username.fill(username)
    await this.password.fill(password)
    await this.submit.click()
  }

  /** Text of the whole window; the editor console is part of it while its panel shows. */
  bodyText(): Promise<string> {
    return this.page.locator('body').innerText()
  }

  /** Kills the app with its child processes, which write into the profile, and deletes the profile and project. */
  async quit(): Promise<void> {
    const child = this.app.process()
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32' || child.pid === undefined) child.kill('SIGKILL')
      else process.kill(-child.pid, 'SIGKILL')
      await exited
    }
    rmSync(this.paths.root, { recursive: true, force: true })
  }
}
