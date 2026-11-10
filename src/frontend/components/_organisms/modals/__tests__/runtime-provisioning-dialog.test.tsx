import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { DevicePort } from '../../../../../middleware/shared/ports/device-port'
import type {
  RuntimeProvisioningOperation,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningPhase,
} from '../../../../../middleware/shared/ports/runtime-provisioning-port'
import type { PlatformPorts } from '../../../../../middleware/shared/providers/types'
import { createPlatformPorts } from '../../../../services/__tests__/fixtures/platform-ports'
import {
  connectionStatus,
  createCallLog,
  createFakeDevice,
  DEVICE_IP,
  FakeProvisioning,
  FakeRuntime,
  type PortCallLog,
  RUNTIME_V4,
  selectRuntimeTarget,
  serializedState,
  settle,
  SSH_PASSWORD,
  SSH_USERNAME,
  unexpectedCalls,
} from '../../../../services/__tests__/fixtures/runtime-ports'
import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import {
  provisioningMessage,
  type ProvisioningMessageKey,
  WHAT_WILL_BE_DONE,
} from '../../../../utils/runtime-provisioning-messages'
import { getMemoryState, listeners, type State } from '../../../../utils/toast'
import { RuntimeProvisioningDialog } from '../runtime-provisioning-dialog'

type Facts = Parameters<typeof provisioningMessage>[1]
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
type RecordedToast = { id: string; variant: string | undefined; text: string }
type Ending = [string, RuntimeProvisioningOutcome, Facts]
type CancelRow = [string, RuntimeProvisioningPhase, RuntimeProvisioningOperation | undefined]

const STARTED_AT = 1_700_000_000_000
const ENDED_AT = 1_700_000_090_000
const DOCUMENTATION_HOST = '192.0.2.10'
const WRONG_PASSWORD = 'wrong-pass'
const LATEST_LINE = '[3/6] Pulling ghcr.io/autonomy-logic/openplc-runtime:latest'
const MARKUP_LINE = 'Step 4/6: <docker> **pull** \\n 50% & done'
const CLOSE_NAME = /close/i
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug']
const FAILURE_LINES = ['Reading package lists...', 'E: Unable to locate package docker-ce']
const BASE_FACTS: Facts = { host: DEVICE_IP, sshPort: 22 }
const START_FAILURE_LINE = 'Error response from daemon: No such container: openplc-runtime'
const START_FAILED_TITLE = 'Runtime start failed'

const ENDINGS: Ending[] = [
  ['connected-ready', { kind: 'connected-ready', operation: 'install' }, { ...BASE_FACTS, operation: 'install' }],
  ['cancelled', { kind: 'cancelled' }, BASE_FACTS],
  ['unknown', { kind: 'unknown' }, BASE_FACTS],
  ['ssh-unreachable', { kind: 'ssh-unreachable' }, BASE_FACTS],
  [
    'host-key-changed',
    { kind: 'host-key-changed', target: `${DEVICE_IP}:22` },
    { ...BASE_FACTS, target: `${DEVICE_IP}:22` },
  ],
  ['host-key-file-unusable', { kind: 'host-key-file-unusable' }, BASE_FACTS],
  ['host-key-not-saved', { kind: 'host-key-not-saved' }, BASE_FACTS],
  ['password-auth-not-accepted', { kind: 'password-auth-not-accepted' }, BASE_FACTS],
  ['no-admin-rights', { kind: 'no-admin-rights' }, BASE_FACTS],
  [
    'unsupported',
    { kind: 'unsupported', reason: 'arch', detail: 'mips' },
    { ...BASE_FACTS, reason: 'arch', detail: 'mips' },
  ],
  ['v3-present', { kind: 'v3-present' }, BASE_FACTS],
  ['download-failed', { kind: 'download-failed', dockerPresent: false }, { ...BASE_FACTS, dockerPresent: false }],
  ['installer-failed', { kind: 'installer-failed', lastLines: FAILURE_LINES }, BASE_FACTS],
  ['start-failed', { kind: 'start-failed', lastLines: [START_FAILURE_LINE] }, BASE_FACTS],
  [
    'not-started after an install',
    { kind: 'not-started', operation: 'install', lastLines: FAILURE_LINES },
    { ...BASE_FACTS, operation: 'install' },
  ],
  [
    'not-started after a start',
    { kind: 'not-started', operation: 'start', lastLines: [] },
    { ...BASE_FACTS, operation: 'start' },
  ],
]

const SUCCESSFUL_ENDINGS = ENDINGS.filter(([, outcome]) => outcome.kind === 'connected-ready')
const FAILED_ENDINGS = ENDINGS.filter(([, outcome]) => !['connected-ready', 'cancelled'].includes(outcome.kind))
const ENDINGS_WITH_LAST_LINES = ENDINGS.filter(
  ([, outcome]) =>
    outcome.kind === 'installer-failed' ||
    outcome.kind === 'start-failed' ||
    (outcome.kind === 'not-started' && outcome.operation === 'install'),
)
const ENDINGS_WITHOUT_LAST_LINES = ENDINGS.filter(
  ([ending]) => !ENDINGS_WITH_LAST_LINES.some(([name]) => name === ending),
)

const CANCELLABLE_PHASES: CancelRow[] = [
  ['the SSH login of an install', 'connecting', undefined],
  ['the inspection of an install', 'inspecting', undefined],
  ['the inspection of a start', 'inspecting', 'start'],
]

const PHASES_PAST_CANCEL: CancelRow[] = [
  ['the installer started on the device', 'installing', 'install'],
  ['the start command sent to the device', 'starting', 'start'],
  ['the wait for the installed runtime', 'waiting-runtime', 'install'],
]

const LABELLED_PHASES: [RuntimeProvisioningPhase, RuntimeProvisioningOperation | undefined][] = [
  ['connecting', undefined],
  ['inspecting', undefined],
  ['starting', 'start'],
  ['installing', 'install'],
  ['waiting-runtime', 'install'],
]

const SUBMIT_STATES: [string, string, string, boolean][] = [
  ['', '', 'disabled', true],
  ['', SSH_PASSWORD, 'disabled', true],
  [SSH_USERNAME, '', 'disabled', true],
  [SSH_USERNAME, SSH_PASSWORD, 'enabled', false],
]

const REFUSED_CREDENTIALS: [string, string, string, 'username' | 'password'][] = [
  ['a username of 33 characters', 'u'.repeat(33), 'S3cr3t-8', 'username'],
  ['a password of 1,025 characters', SSH_USERNAME, 'p'.repeat(1025), 'password'],
  ['a password with a tab character', SSH_USERNAME, 'S3cr3t\t-Pi!', 'password'],
]

const REFUSED_PORT_TEXTS = ['0', '65536', '22.5', 'ssh', '']

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning
let device: DevicePort
let ports: PlatformPorts
let knownToastIds: Set<string>
let toasts: RecordedToast[]
let consoleLines: string[]
let restoreConsole: (() => void)[]
let operationSequence = 1_000_000

function nextOperationId(): number {
  operationSequence += 1
  return operationSequence
}

function actions() {
  return store.getState().runtimeProvisioningActions
}

function slice() {
  return store.getState().runtimeProvisioning
}

function offerNotice() {
  const view = slice().view
  return view.stage === 'offer' ? view.notice : null
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function textOf(node: ReactNode): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

function recordToasts(state: State): void {
  for (const shown of state.toasts) {
    if (knownToastIds.has(shown.id) || toasts.some(({ id }) => id === shown.id)) continue
    toasts.push({
      id: shown.id,
      variant: shown.variant,
      text: `${textOf(shown.title)}\n${textOf(shown.description)}`,
    })
  }
}

function captureConsole(): void {
  for (const method of CONSOLE_METHODS) {
    const original = console[method]
    console[method] = (...args: unknown[]) => {
      consoleLines.push(args.map(describeValue).join(' '))
      Reflect.apply(original, console, args)
    }
    restoreConsole.push(() => {
      console[method] = original
    })
  }
}

function storageText(storage: Storage): string {
  const entries: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null) entries.push(`${key}=${storage.getItem(key) ?? ''}`)
  }
  return entries.join('\n')
}

function attributesHolding(secret: string): string[] {
  const found: string[] = []
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const isPasswordInput = element.getAttribute('data-testid') === 'runtime-provisioning-password'
    for (const attribute of Array.from(element.attributes)) {
      if (isPasswordInput && attribute.name === 'value') continue
      if (attribute.value.includes(secret)) found.push(`${element.tagName.toLowerCase()}[${attribute.name}]`)
    }
  }
  return found
}

function renderDialog(platform: PlatformPorts = ports) {
  return render(<RuntimeProvisioningDialog />, { wrapper: createStoreWrapper(store, platform) })
}

function dialog(): HTMLElement {
  return screen.getByTestId('runtime-provisioning-dialog')
}

function dialogShown(): boolean {
  return screen.queryByTestId('runtime-provisioning-dialog') !== null
}

function input(testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId)
  if (!(element instanceof HTMLInputElement)) throw new Error(`${testId} is not an input`)
  return element
}

function button(testId: string): HTMLButtonElement {
  const element = screen.getByTestId(testId)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`${testId} is not a button`)
  return element
}

function closeIconButton(container: HTMLElement): HTMLButtonElement {
  const found = within(container)
    .getAllByRole('button')
    .find(
      (candidate) =>
        !candidate.hasAttribute('data-testid') &&
        CLOSE_NAME.test(`${candidate.getAttribute('aria-label') ?? ''} ${candidate.textContent ?? ''}`),
    )
  if (!(found instanceof HTMLButtonElement)) throw new Error('the dialog has no X button')
  return found
}

function fill(testId: string, value: string): void {
  fireEvent.change(input(testId), { target: { value } })
}

function fillCredentials(username: string, password: string): void {
  fill('runtime-provisioning-username', username)
  fill('runtime-provisioning-password', password)
}

function shownText(element: HTMLElement = dialog()): string {
  return normalize(element.textContent ?? '')
}

function messageLines(key: ProvisioningMessageKey, facts: Facts): string[] {
  const { title, body } = provisioningMessage(key, facts)
  return [title, ...body.split('\n')].map(normalize).filter((line) => line !== '')
}

function missingLines(key: ProvisioningMessageKey, facts: Facts, element: HTMLElement = dialog()): string[] {
  const text = shownText(element)
  return messageLines(key, facts).filter((line) => !text.includes(line))
}

function deepestElementWith(container: HTMLElement, text: string): Element {
  const matches = Array.from(container.querySelectorAll('*')).filter((element) =>
    normalize(element.textContent ?? '').includes(text),
  )
  const deepest = matches.find((element) => !matches.some((other) => other !== element && element.contains(other)))
  if (deepest === undefined) throw new Error(`nothing in the dialog shows "${text}"`)
  return deepest
}

function textColourClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter((name) => /^(dark:)?text-(white|black|neutral-\d+)$/.test(name))
    .sort()
}

function follows(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function expandWhatWillBeDone(): void {
  const disclosure = screen.getByTestId('runtime-provisioning-what-will-be-done')
  fireEvent.click(within(disclosure).queryByText(/what will be done on the device/i) ?? disclosure)
}

function showOffer(host = DEVICE_IP, sshPort = 22): void {
  act(() => {
    actions().showOffer(host, sshPort)
  })
}

function startRunning(
  phase: RuntimeProvisioningPhase,
  cancellable: boolean,
  operation?: RuntimeProvisioningOperation,
  operationId = nextOperationId(),
): void {
  act(() => {
    actions().showOffer(DEVICE_IP, 22)
    actions().startRun({ host: DEVICE_IP, sshPort: 22, operationId, startedAt: STARTED_AT })
    actions().applyEvent({ type: 'phase', phase, cancellable, operation })
  })
}

function endWith(
  outcome: RuntimeProvisioningOutcome,
  lines: string[] = [],
  operationId = nextOperationId(),
  visible = true,
): void {
  act(() => {
    actions().showOffer(DEVICE_IP, 22)
    actions().startRun({ host: DEVICE_IP, sshPort: 22, operationId, startedAt: STARTED_AT })
    for (const line of lines) actions().applyEvent({ type: 'output', line })
    actions().setDialogVisible(visible)
    actions().finishRun(outcome, ENDED_AT)
    actions().setDialogVisible(visible)
  })
}

function withLastLines(outcome: RuntimeProvisioningOutcome, lastLines: string[]): RuntimeProvisioningOutcome {
  if (outcome.kind === 'installer-failed') return { kind: 'installer-failed', lastLines }
  if (outcome.kind === 'start-failed') return { kind: 'start-failed', lastLines }
  if (outcome.kind === 'not-started') return { kind: 'not-started', operation: outcome.operation, lastLines }
  return outcome
}

function outputLine(index: number): string {
  return `installer output ${String(index).padStart(3, '0')}`
}

function outputLines(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_unused, offset) => outputLine(from + offset))
}

async function pressSubmit(): Promise<void> {
  await act(async () => {
    fireEvent.click(button('runtime-provisioning-submit'))
    await Promise.resolve()
  })
}

async function runStarted(count = 1): Promise<void> {
  await act(() => settle(() => provisioning.runRequests.length === count && provisioning.pendingRunCount === 1))
}

async function endRun(outcome: RuntimeProvisioningOutcome): Promise<void> {
  await act(async () => {
    provisioning.endRun(outcome)
    await settle(() => slice().view.stage !== 'running')
  })
}

async function submitAndStart(username = SSH_USERNAME, password = SSH_PASSWORD, count = 1): Promise<void> {
  fillCredentials(username, password)
  await pressSubmit()
  await runStarted(count)
}

beforeEach(() => {
  store = createTestStore()
  log = createCallLog()
  runtime = new FakeRuntime(log)
  provisioning = new FakeProvisioning(log)
  device = createFakeDevice(log)
  ports = createPlatformPorts(log, { runtime: runtime.port, device, runtimeProvisioning: provisioning.port })
  selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP)
  knownToastIds = new Set(getMemoryState().toasts.map(({ id }) => id))
  toasts = []
  listeners.push(recordToasts)
  consoleLines = []
  restoreConsole = []
  captureConsole()
})

afterEach(() => {
  jest.useRealTimers()
  listeners.splice(listeners.indexOf(recordToasts), 1)
  for (const restore of restoreConsole) restore()
  expect(unexpectedCalls(log)).toEqual([])
})

describe('the provisioning dialog before an offer', () => {
  it('shows nothing while no operation is offered', () => {
    renderDialog()

    expect(dialogShown()).toBe(false)
  })
})

describe('the offer stage', () => {
  it('opens a dedicated "Install OpenPLC Runtime" dialog asking for the device login credentials for the host (TC06, AS-16)', () => {
    renderDialog()

    showOffer(DOCUMENTATION_HOST, 22)
    const text = shownText()

    expect(missingLines('offer', { host: DOCUMENTATION_HOST, sshPort: 22 })).toEqual([])
    expect(text).toContain(DOCUMENTATION_HOST)
    expect(text).toContain('Install OpenPLC Runtime')
    expect(text).toContain(`Enter your device login credentials to install OpenPLC Runtime on ${DOCUMENTATION_HOST}.`)
    expect(text).not.toContain('Install or start')
    expect(text).not.toContain('is not running')
  })

  it('labels the submit button "Install"', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    const submit = button('runtime-provisioning-submit')

    expect(submit.textContent?.trim()).toBe('Install')
    expect(screen.getByRole('button', { name: 'Install' })).toBe(submit)
    expect(screen.queryByRole('button', { name: 'Install or start' })).toBeNull()
  })

  it('keeps the Decline button labelled "Decline"', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    expect(button('runtime-provisioning-decline').textContent?.trim()).toBe('Decline')
  })

  it('is neither the runtime login dialog nor the first-user dialog (TC06)', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    expect(dialogShown()).toBe(true)
    expect(store.getState().modals['runtime-login'].open).toBe(false)
    expect(store.getState().modals['runtime-create-user'].open).toBe(false)
  })

  it('asks for a username, a hidden password and the SSH port prefilled with the port that answered (AC08.3)', () => {
    actions().showOffer(DEVICE_IP, 2222)
    renderDialog()

    expect(input('runtime-provisioning-username').type).toBe('text')
    expect(input('runtime-provisioning-username').value).toBe('')
    expect(input('runtime-provisioning-password').type).toBe('password')
    expect(input('runtime-provisioning-password').value).toBe('')
    expect(input('runtime-provisioning-ssh-port').value).toBe('2222')
  })

  it('contacts nothing on the device while the offer is open (TC06, AC02.1)', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    fillCredentials(SSH_USERNAME, SSH_PASSWORD)

    expect(log.calls).toEqual([])
  })

  it('reaches nothing on the device when the offer stays open for 60 s without acceptance (TC18)', () => {
    jest.useFakeTimers()
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    expect(provisioning.runRequests).toEqual([])
    expect(provisioning.probeRequests).toEqual([])
    expect(log.calls).toEqual([])
  })

  it('keeps "What will be done on the device" collapsed until the user expands it', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    const text = shownText()

    expect(screen.getByTestId('runtime-provisioning-what-will-be-done')).toBeTruthy()
    expect(text).not.toContain(normalize(WHAT_WILL_BE_DONE.ifInstalled))
    expect(WHAT_WILL_BE_DONE.install.filter((step) => text.includes(normalize(step)))).toEqual([])
  })

  it('lists both outcomes once expanded: start what is stopped, otherwise every install step (TC23, AC09.1)', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    expandWhatWillBeDone()
    const text = shownText()

    expect(text).toContain(normalize(WHAT_WILL_BE_DONE.ifInstalled))
    expect(WHAT_WILL_BE_DONE.install.filter((step) => !text.includes(normalize(step)))).toEqual([])
    expect(log.calls).toEqual([])
  })

  it('shows the short explanation above the expanded list (TC23)', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    expandWhatWillBeDone()
    const [explanation] = messageLines('offer', BASE_FACTS).slice(1)
    const firstStep = normalize(WHAT_WILL_BE_DONE.install[0])

    expect(follows(deepestElementWith(dialog(), explanation), deepestElementWith(dialog(), firstStep))).toBe(true)
  })

  it.each(SUBMIT_STATES)(
    'with username "%s" and password "%s", Submit is %s and nothing is sent (TC20)',
    (username, password, _state, disabled) => {
      actions().showOffer(DEVICE_IP, 22)
      renderDialog()

      fillCredentials(username, password)

      expect(button('runtime-provisioning-submit').disabled).toBe(disabled)
      expect(log.calls).toEqual([])
    },
  )

  it('sends the offer host, the SSH port field and the credentials once on Submit', async () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()
    fill('runtime-provisioning-ssh-port', '2222')

    await submitAndStart()

    expect(provisioning.runRequests).toEqual([
      { host: DEVICE_IP, port: 2222, username: SSH_USERNAME, password: SSH_PASSWORD },
    ])
    expect(log.calls).toEqual(['provisioning.run'])
  })

  it('accepts a username of 32 characters and a password of 1,024 characters (TC56)', async () => {
    const username = 'u'.repeat(32)
    const password = 'p'.repeat(1024)
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    await submitAndStart(username, password)

    expect(provisioning.runRequests).toEqual([{ host: DEVICE_IP, port: 22, username, password }])
  })

  it.each(REFUSED_CREDENTIALS)(
    'refuses %s with the "Input refused" message for that field and no login (TC56)',
    async (_case, username, password, field) => {
      actions().showOffer(DEVICE_IP, 22)
      renderDialog()

      fillCredentials(username, password)
      await pressSubmit()
      await act(() => settle(() => offerNotice() !== null))

      expect(missingLines('input-refused', { field })).toEqual([])
      expect(log.calls).toEqual([])
    },
  )

  it.each(REFUSED_PORT_TEXTS)(
    'refuses the SSH port text "%s" with the "Input refused" message and no call (AC11.4)',
    async (portText) => {
      actions().showOffer(DEVICE_IP, 22)
      renderDialog()

      fillCredentials(SSH_USERNAME, SSH_PASSWORD)
      fill('runtime-provisioning-ssh-port', portText)
      await pressSubmit()

      expect(missingLines('input-refused', { field: 'port' })).toEqual([])
      expect(provisioning.runRequests).toEqual([])
      expect(log.calls).toEqual([])
    },
  )

  it('shows the "Input refused" message of a notice for its field', () => {
    actions().showOffer(DEVICE_IP, 22)
    actions().setOfferNotice({ kind: 'input-refused', field: 'username' })
    renderDialog()

    expect(missingLines('input-refused', { field: 'username' })).toEqual([])
  })
})

describe('the credential labels of the offer (AC02.1, AC08.3)', () => {
  it.each(['Device username', 'Device password', 'SSH port'])(
    'colours "%s" dark in the light theme and white in the dark theme, like the other labels',
    (text) => {
      actions().showOffer(DEVICE_IP, 22)
      renderDialog()

      const label = within(dialog()).getByText(text, { selector: 'label' })

      expect(textColourClasses(label)).toEqual(['dark:text-white', 'text-neutral-950'])
    },
  )
})

describe('leaving the offer without accepting', () => {
  const LEAVE_ACTIONS: [string, () => void][] = [
    [
      'presses Decline',
      () => {
        fireEvent.click(button('runtime-provisioning-decline'))
      },
    ],
    [
      'closes the dialog with its X',
      () => {
        fireEvent.click(closeIconButton(dialog()))
      },
    ],
    [
      'presses Escape',
      () => {
        fireEvent.keyDown(dialog(), { key: 'Escape' })
      },
    ],
  ]

  it.each(LEAVE_ACTIONS)(
    'closes the dialog, contacts nothing and stays disconnected when the user %s (TC19, AC02.2)',
    (_action, leave) => {
      actions().showOffer(DEVICE_IP, 22)
      renderDialog()
      fillCredentials(SSH_USERNAME, SSH_PASSWORD)

      act(leave)

      expect(dialogShown()).toBe(false)
      expect(slice().view).toEqual({ stage: 'idle' })
      expect(slice().dialogVisible).toBe(false)
      expect(connectionStatus(store)).toBe('disconnected')
      expect(provisioning.runRequests).toEqual([])
      expect(log.calls).toEqual([])
    },
  )
})

describe('a rejected login', () => {
  async function rejectedLogin(): Promise<void> {
    actions().showOffer(DEVICE_IP, 2222)
    renderDialog()
    await submitAndStart(SSH_USERNAME, WRONG_PASSWORD)
    await endRun({ kind: 'auth-rejected' })
  }

  it('keeps the username and SSH port and empties the password (TC30, BR31)', async () => {
    await rejectedLogin()

    expect(input('runtime-provisioning-username').value).toBe(SSH_USERNAME)
    expect(input('runtime-provisioning-ssh-port').value).toBe('2222')
    expect(input('runtime-provisioning-password').value).toBe('')
  })

  it('shows the "Login rejected" message (TC30)', async () => {
    await rejectedLogin()

    expect(missingLines('auth-rejected', { host: DEVICE_IP, sshPort: 2222 })).toEqual([])
  })

  it('shows the "Login rejected" message above the form', async () => {
    await rejectedLogin()

    const [title] = messageLines('auth-rejected', { host: DEVICE_IP, sshPort: 2222 })

    expect(follows(deepestElementWith(dialog(), title), input('runtime-provisioning-username'))).toBe(true)
  })

  it('retries in the same operation with the kept username and port and the new password (TC30)', async () => {
    await rejectedLogin()

    await submitAndStart(SSH_USERNAME, SSH_PASSWORD, 2)

    expect(provisioning.runRequests).toEqual([
      { host: DEVICE_IP, port: 2222, username: SSH_USERNAME, password: WRONG_PASSWORD },
      { host: DEVICE_IP, port: 2222, username: SSH_USERNAME, password: SSH_PASSWORD },
    ])
  })
})

describe('the running stage', () => {
  it('shows the latest installer line exactly as received (TC43)', () => {
    startRunning('installing', false, 'install')
    renderDialog()

    act(() => {
      actions().applyEvent({ type: 'output', line: 'Downloading the installer' })
      actions().applyEvent({ type: 'output', line: LATEST_LINE })
    })

    expect(screen.getByTestId('runtime-provisioning-latest-line').textContent).toBe(LATEST_LINE)
  })

  it('shows a line that looks like markup unparsed', () => {
    startRunning('installing', false, 'install')
    renderDialog()

    act(() => {
      actions().applyEvent({ type: 'output', line: MARKUP_LINE })
    })

    expect(screen.getByTestId('runtime-provisioning-latest-line').textContent).toBe(MARKUP_LINE)
  })

  it('shows the time elapsed since the start as m:ss (TC43)', () => {
    jest.useFakeTimers()
    jest.setSystemTime(STARTED_AT + 65_000)
    startRunning('installing', false, 'install')

    renderDialog()

    expect(screen.getByTestId('runtime-provisioning-elapsed').textContent).toMatch(/(^|\D)1:05(\D|$)/)
  })

  it('refreshes the elapsed time every second (TC43, AC09.3)', () => {
    jest.useFakeTimers()
    jest.setSystemTime(STARTED_AT + 9_000)
    startRunning('installing', false, 'install')
    renderDialog()

    act(() => {
      jest.advanceTimersByTime(1_000)
    })
    const afterOneSecond = screen.getByTestId('runtime-provisioning-elapsed').textContent
    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    expect(afterOneSecond).toMatch(/(^|\D)0:10(\D|$)/)
    expect(screen.getByTestId('runtime-provisioning-elapsed').textContent).toMatch(/(^|\D)1:10(\D|$)/)
  })

  it('labels each phase differently', () => {
    jest.useFakeTimers()
    jest.setSystemTime(STARTED_AT)
    startRunning('connecting', false)
    renderDialog()

    const texts = LABELLED_PHASES.map(([phase, operation]) => {
      act(() => {
        actions().applyEvent({ type: 'phase', phase, cancellable: false, operation })
      })
      return shownText()
    })

    expect(new Set(texts).size).toBe(LABELLED_PHASES.length)
  })

  it.each(CANCELLABLE_PHASES)('offers Cancel during %s (TC45, AC09.4)', (_phase, phase, operation) => {
    startRunning(phase, true, operation)
    renderDialog()

    expect(screen.queryByTestId('runtime-provisioning-cancel')).not.toBeNull()
  })

  it.each(CANCELLABLE_PHASES)(
    'asks the device side to cancel once when Cancel is pressed during %s (TC45)',
    async (_phase, phase, operation) => {
      startRunning(phase, true, operation)
      renderDialog()

      await act(async () => {
        fireEvent.click(button('runtime-provisioning-cancel'))
        await settle(() => provisioning.cancelCalls > 0)
      })

      expect(provisioning.cancelCalls).toBe(1)
      expect(log.calls).toEqual(['provisioning.cancel'])
    },
  )

  it.each(PHASES_PAST_CANCEL)('offers Hide and no Cancel once %s (TC45, AC09.4)', (_phase, phase, operation) => {
    startRunning(phase, false, operation)
    renderDialog()

    expect(screen.queryByTestId('runtime-provisioning-cancel')).toBeNull()
    expect(screen.queryByTestId('runtime-provisioning-hide')).not.toBeNull()
  })

  it('removes Cancel when the operation passes the point where it can be cancelled', () => {
    startRunning('inspecting', true, 'install')
    renderDialog()

    act(() => {
      actions().applyEvent({ type: 'phase', phase: 'installing', cancellable: false, operation: 'install' })
    })

    expect(screen.queryByTestId('runtime-provisioning-cancel')).toBeNull()
  })

  const HIDE_ACTIONS: [string, () => void][] = [
    [
      'Hide',
      () => {
        fireEvent.click(button('runtime-provisioning-hide'))
      },
    ],
    [
      'the X',
      () => {
        fireEvent.click(closeIconButton(dialog()))
      },
    ],
    [
      'Escape',
      () => {
        fireEvent.keyDown(dialog(), { key: 'Escape' })
      },
    ],
  ]

  it.each(HIDE_ACTIONS)('hides the dialog on %s and never cancels the run (TC44, BR25)', (_action, hide) => {
    startRunning('installing', false, 'install')
    renderDialog()
    const view = slice().view

    act(hide)

    expect(dialogShown()).toBe(false)
    expect(slice().dialogVisible).toBe(false)
    expect(slice().view).toEqual(view)
    expect(provisioning.cancelCalls).toBe(0)
    expect(log.calls).toEqual([])
  })

  it('hides a cancellable run on Escape without cancelling it', () => {
    startRunning('inspecting', true, 'install')
    renderDialog()

    act(() => {
      fireEvent.keyDown(dialog(), { key: 'Escape' })
    })

    expect(slice().dialogVisible).toBe(false)
    expect(provisioning.cancelCalls).toBe(0)
  })

  it('keeps the form through a hidden run, so a rejected login still shows the username and port (TC44)', async () => {
    actions().showOffer(DEVICE_IP, 2222)
    renderDialog()
    await submitAndStart(SSH_USERNAME, WRONG_PASSWORD)
    act(() => {
      fireEvent.click(button('runtime-provisioning-hide'))
    })
    const pendingWhileHidden = provisioning.pendingRunCount

    act(() => {
      actions().setDialogVisible(true)
    })
    await endRun({ kind: 'auth-rejected' })

    expect(pendingWhileHidden).toBe(1)
    expect(input('runtime-provisioning-username').value).toBe(SSH_USERNAME)
    expect(input('runtime-provisioning-ssh-port').value).toBe('2222')
  })
})

describe('the ended stage', () => {
  it.each(ENDINGS)('shows the message of a %s ending', (_ending, outcome, facts) => {
    const lines = 'lastLines' in outcome ? outcome.lastLines : []
    endWith(outcome, lines)
    renderDialog()

    expect(missingLines(outcome.kind, facts)).toEqual([])
  })

  it.each(ENDINGS)('shows the title of a %s ending once, followed by its body', (_ending, outcome, facts) => {
    const lines = 'lastLines' in outcome ? outcome.lastLines : []
    endWith(outcome, lines)
    renderDialog()
    const [title, ...bodyLines] = messageLines(outcome.kind, facts)

    const titled = Array.from(dialog().querySelectorAll('*')).filter(
      (element) => normalize(element.textContent ?? '') === title,
    )

    expect(titled).toHaveLength(1)
    expect(bodyLines.filter((line) => !shownText().includes(line))).toEqual([])
    expect(follows(titled[0], deepestElementWith(dialog(), bodyLines[0]))).toBe(true)
  })

  it.each(ENDINGS_WITH_LAST_LINES)(
    'shows the last 200 installer lines of a %s ending (TC39, AC09.5)',
    (_e, outcome) => {
      const lastLines = outputLines(1, 240)
      endWith(withLastLines(outcome, lastLines), lastLines)
      renderDialog()

      const shown = shownText(screen.getByTestId('runtime-provisioning-last-lines'))

      expect(shown).toContain(outputLine(41))
      expect(shown).toContain(outputLine(240))
      expect(shown).not.toContain(outputLine(40))
    },
  )

  it.each(ENDINGS_WITHOUT_LAST_LINES)('shows no installer lines for a %s ending', (_ending, outcome) => {
    endWith(outcome, FAILURE_LINES)
    renderDialog()

    expect(screen.queryByTestId('runtime-provisioning-last-lines')).toBeNull()
  })

  it('shows the line of a failed start command under one "Runtime start failed" title, with no 120 s wording (P18)', () => {
    endWith({ kind: 'start-failed', lastLines: [START_FAILURE_LINE] })
    renderDialog()

    const titled = Array.from(dialog().querySelectorAll('*')).filter(
      (element) => normalize(element.textContent ?? '') === START_FAILED_TITLE,
    )

    expect(shownText(screen.getByTestId('runtime-provisioning-last-lines'))).toContain(START_FAILURE_LINE)
    expect(titled).toHaveLength(1)
    expect(shownText()).not.toContain('120')
    expect(shownText()).not.toContain('was started')
  })

  it('offers no way to accept a changed host key (TC26, BR15)', () => {
    endWith({ kind: 'host-key-changed', target: `${DEVICE_IP}:22` })
    renderDialog()

    const labels = within(dialog())
      .getAllByRole('button')
      .map((candidate) => `${candidate.getAttribute('aria-label') ?? ''} ${candidate.textContent ?? ''}`)

    expect(labels.filter((label) => /forget|trust|accept|anyway|replace|remove|update/i.test(label))).toEqual([])
  })

  it('shows a refused password login without the "Login rejected" message (TC57)', () => {
    endWith({ kind: 'password-auth-not-accepted' })
    renderDialog()

    const [loginRejectedTitle] = messageLines('auth-rejected', BASE_FACTS)

    expect(shownText()).not.toContain(loginRejectedTitle)
  })

  it('acknowledges the ending and closes on Close', () => {
    endWith({ kind: 'installer-failed', lastLines: FAILURE_LINES }, FAILURE_LINES)
    renderDialog()

    act(() => {
      fireEvent.click(button('runtime-provisioning-close'))
    })

    expect(dialogShown()).toBe(false)
    expect(slice().view).toEqual({ stage: 'idle' })
    expect(slice().dialogVisible).toBe(false)
    expect(log.calls).toEqual([])
  })
})

describe('the toast at the end of an operation', () => {
  it.each(SUCCESSFUL_ENDINGS)('reports a %s ending of a hidden dialog with one success toast (TC49)', (_e, outcome) => {
    renderDialog()

    endWith(outcome, [], nextOperationId(), false)

    expect(toasts.map(({ variant }) => variant === 'fail')).toEqual([false])
  })

  it.each(FAILED_ENDINGS)('reports a %s ending of a hidden dialog with one failure toast (TC49)', (_e, outcome) => {
    renderDialog()

    endWith(outcome, [], nextOperationId(), false)

    expect(toasts.map(({ variant }) => variant)).toEqual(['fail'])
  })

  it('reports a failed start command with one "Runtime start failed" failure toast and its body (P18)', () => {
    renderDialog()

    endWith({ kind: 'start-failed', lastLines: [START_FAILURE_LINE] }, [], nextOperationId(), false)

    expect(toasts.map(({ variant, text }) => ({ variant, text }))).toEqual([
      {
        variant: 'fail',
        text: `${START_FAILED_TITLE}\nThe OpenPLC Runtime could not be started on ${DEVICE_IP}: the start command failed. Nothing was installed. Its last lines are in the editor console.`,
      },
    ])
  })

  it('reports a cancelled operation with no toast (P12)', () => {
    renderDialog()

    endWith({ kind: 'cancelled' }, [], nextOperationId(), false)

    expect(toasts).toEqual([])
  })

  it('reports a successful ending of a visible dialog with one toast that is not a failure', () => {
    renderDialog()

    endWith({ kind: 'connected-ready', operation: 'install' }, [], nextOperationId(), true)

    expect(toasts.map(({ variant }) => variant === 'fail')).toEqual([false])
  })

  it('fires once per operation, whatever happens to the dialog afterwards', () => {
    const view = renderDialog()
    endWith({ kind: 'installer-failed', lastLines: FAILURE_LINES }, FAILURE_LINES, nextOperationId(), true)

    act(() => {
      actions().setDialogVisible(false)
    })
    act(() => {
      actions().setDialogVisible(true)
    })
    view.rerender(<RuntimeProvisioningDialog />)
    act(() => {
      actions().acknowledgeEnding()
    })

    expect(toasts).toHaveLength(1)
  })

  it('fires again for the next operation', () => {
    renderDialog()
    endWith({ kind: 'installer-failed', lastLines: FAILURE_LINES }, FAILURE_LINES, nextOperationId(), false)
    act(() => {
      actions().acknowledgeEnding()
    })

    endWith({ kind: 'download-failed', dockerPresent: true }, [], nextOperationId(), false)

    expect(toasts.map(({ variant }) => variant)).toEqual(['fail', 'fail'])
  })

  it('stays silent while an operation is offered or running', () => {
    renderDialog()

    startRunning('installing', false, 'install')
    act(() => {
      actions().applyEvent({ type: 'output', line: LATEST_LINE })
    })

    expect(toasts).toEqual([])
  })
})

describe('consent on every operation', () => {
  it('opens the next offer with empty username and password after a successful operation (TC22, AC09.2)', async () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()
    await submitAndStart()
    await endRun({ kind: 'connected-ready', operation: 'start' })
    await act(() => settle(() => store.getState().modals['runtime-login'].open))
    act(() => {
      store.getState().modalActions.closeModal()
      store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
    })

    showOffer(DEVICE_IP, 22)

    expect(dialogShown()).toBe(true)
    expect(input('runtime-provisioning-username').value).toBe('')
    expect(input('runtime-provisioning-password').value).toBe('')
  })

  it('opens the next offer with empty fields after a decline', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()
    fillCredentials(SSH_USERNAME, SSH_PASSWORD)
    act(() => {
      fireEvent.click(button('runtime-provisioning-decline'))
    })

    showOffer(DEVICE_IP, 22)

    expect(input('runtime-provisioning-username').value).toBe('')
    expect(input('runtime-provisioning-password').value).toBe('')
  })
})

describe('the device password', () => {
  it('stays out of the store, the web storage and every attribute but the input value while typed (AS-10)', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    fillCredentials(SSH_USERNAME, SSH_PASSWORD)

    expect(input('runtime-provisioning-password').value).toBe(SSH_PASSWORD)
    expect(attributesHolding(SSH_PASSWORD)).toEqual([])
    expect(serializedState(store)).not.toContain(SSH_PASSWORD)
    expect(storageText(localStorage)).not.toContain(SSH_PASSWORD)
    expect(storageText(sessionStorage)).not.toContain(SSH_PASSWORD)
  })

  it('stays out of the store, the web storage, the DOM and the console after submit (AS-10, M14)', async () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    await submitAndStart()

    expect(attributesHolding(SSH_PASSWORD)).toEqual([])
    expect(shownText(document.body)).not.toContain(SSH_PASSWORD)
    expect(serializedState(store)).not.toContain(SSH_PASSWORD)
    expect(storageText(localStorage)).not.toContain(SSH_PASSWORD)
    expect(storageText(sessionStorage)).not.toContain(SSH_PASSWORD)
    expect(consoleLines.filter((line) => line.includes(SSH_PASSWORD))).toEqual([])
  })

  it('stays out of the store and the web storage after a rejected login, with the input empty (AS-10)', async () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()
    await submitAndStart()

    await endRun({ kind: 'auth-rejected' })

    expect(input('runtime-provisioning-password').value).toBe('')
    expect(attributesHolding(SSH_PASSWORD)).toEqual([])
    expect(serializedState(store)).not.toContain(SSH_PASSWORD)
    expect(storageText(localStorage)).not.toContain(SSH_PASSWORD)
    expect(storageText(sessionStorage)).not.toContain(SSH_PASSWORD)
  })

  it('stays out of the store and the web storage after a decline (AS-10)', () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()
    fillCredentials(SSH_USERNAME, SSH_PASSWORD)

    act(() => {
      fireEvent.click(button('runtime-provisioning-decline'))
    })

    expect(attributesHolding(SSH_PASSWORD)).toEqual([])
    expect(serializedState(store)).not.toContain(SSH_PASSWORD)
    expect(storageText(localStorage)).not.toContain(SSH_PASSWORD)
    expect(storageText(sessionStorage)).not.toContain(SSH_PASSWORD)
  })

  it('is passed to the device side once per submit', async () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()

    await submitAndStart()

    expect(provisioning.runRequests.filter(({ password }) => password === SSH_PASSWORD)).toHaveLength(1)
  })
})

describe('the device username', () => {
  it('is never written to a console line, a console panel message or a toast (BR14)', async () => {
    actions().showOffer(DEVICE_IP, 22)
    renderDialog()
    await submitAndStart()
    act(() => {
      provisioning.emit({ type: 'phase', phase: 'installing', cancellable: false, operation: 'install' })
      provisioning.emit({ type: 'output', line: 'Installing Docker' })
    })

    await endRun({ kind: 'installer-failed', lastLines: ['Installing Docker'] })

    expect(consoleLines.filter((line) => line.includes(SSH_USERNAME))).toEqual([])
    expect(store.getState().logs.filter(({ message }) => message.includes(SSH_USERNAME))).toEqual([])
    expect(toasts.filter(({ text }) => text.includes(SSH_USERNAME))).toEqual([])
  })
})
