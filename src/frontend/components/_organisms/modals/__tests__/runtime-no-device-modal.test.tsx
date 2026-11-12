import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { DevicePort } from '../../../../../middleware/shared/ports/device-port'
import type {
  RuntimeProvisioningPort,
  SshProbeResult,
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
  settle,
  unexpectedCalls,
} from '../../../../services/__tests__/fixtures/runtime-ports'
import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { provisioningMessage, type ProvisioningMessageKey } from '../../../../utils/runtime-provisioning-messages'
import { RuntimeNoDeviceModal } from '../runtime-no-device-modal'
import { RuntimeProvisioningDialog } from '../runtime-provisioning-dialog'

type Facts = Parameters<typeof provisioningMessage>[1]

const DOCUMENTATION_HOST = '192.0.2.10'
const CLOSE_NAME = /close/i
const ACCEPTED_PORTS: [string, number][] = [
  ['1', 1],
  ['65535', 65535],
]
const REFUSED_PORT_TEXTS = ['0', '65536', '22.5', 'ssh', '']

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning
let device: DevicePort
let ports: PlatformPorts

function slice() {
  return store.getState().runtimeProvisioning
}

function noDeviceState() {
  return store.getState().modals['runtime-no-device']
}

function noDeviceSshPort(): unknown {
  const data = noDeviceState().data
  return typeof data === 'object' && data !== null && 'sshPort' in data ? data.sshPort : undefined
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function renderModal(platform: PlatformPorts = ports) {
  return render(<RuntimeNoDeviceModal />, { wrapper: createStoreWrapper(store, platform) })
}

function renderModalAndDialog() {
  return render(
    <>
      <RuntimeNoDeviceModal />
      <RuntimeProvisioningDialog />
    </>,
    { wrapper: createStoreWrapper(store, ports) },
  )
}

function openNoDevice(host = DEVICE_IP, sshPort = 22): void {
  store.getState().modalActions.openModal('runtime-no-device', { host, sshPort })
}

function modal(): HTMLElement {
  return screen.getByTestId('runtime-no-device-modal')
}

function modalShown(): boolean {
  return screen.queryByTestId('runtime-no-device-modal') !== null
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
  if (!(found instanceof HTMLButtonElement)) throw new Error('the message has no X button')
  return found
}

function missingLines(key: ProvisioningMessageKey, facts: Facts): string[] {
  const { title, body } = provisioningMessage(key, facts)
  const text = normalize(modal().textContent ?? '')
  return [title, ...body.split('\n')]
    .map(normalize)
    .filter((line) => line !== '')
    .filter((line) => !text.includes(line))
}

function textColourClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter((name) => /^(dark:)?text-(white|black|neutral-\d+)$/.test(name))
    .sort()
}

function enterPort(text: string): void {
  fireEvent.change(input('runtime-no-device-port-input'), { target: { value: text } })
}

async function tryPort(text: string): Promise<void> {
  enterPort(text)
  await act(async () => {
    fireEvent.click(button('runtime-no-device-try-port'))
    await Promise.resolve()
  })
}

beforeEach(() => {
  store = createTestStore()
  log = createCallLog()
  runtime = new FakeRuntime(log)
  provisioning = new FakeProvisioning(log)
  device = createFakeDevice(log)
  ports = createPlatformPorts(log, { runtime: runtime.port, device, runtimeProvisioning: provisioning.port })
  selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP)
})

afterEach(() => {
  expect(unexpectedCalls(log)).toEqual([])
})

describe('the "No recognized device" message', () => {
  it('shows nothing while the message is closed', () => {
    renderModal()

    expect(modalShown()).toBe(false)
  })

  it('names the address, says neither the runtime nor SSH answered, and offers another SSH port (TC05, AC01.2)', () => {
    openNoDevice(DOCUMENTATION_HOST, 22)
    renderModal()

    expect(missingLines('no-device', { host: DOCUMENTATION_HOST, sshPort: 22 })).toEqual([])
    expect(screen.queryByTestId('runtime-no-device-port-input')).not.toBeNull()
    expect(screen.queryByTestId('runtime-no-device-try-port')).not.toBeNull()
  })

  it('opens when the message is requested while it is mounted', () => {
    renderModal()

    act(() => {
      openNoDevice(DOCUMENTATION_HOST, 22)
    })

    expect(modalShown()).toBe(true)
  })
})

describe('"Try another SSH port"', () => {
  it.each(ACCEPTED_PORTS)('checks SSH on the accepted port %s of the host (TC11, AC11.4)', async (text, port) => {
    openNoDevice()
    renderModal()

    await tryPort(text)
    await act(() => settle(() => provisioning.probeRequests.length === 1))

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port }])
    expect(log.calls).toEqual([`provisioning.probeSsh ${DEVICE_IP}:${port}`])
  })

  it.each(REFUSED_PORT_TEXTS)(
    'refuses the port text "%s" naming the SSH port and the range 1 to 65535, with no check (TC11)',
    async (text) => {
      openNoDevice()
      renderModal()

      await tryPort(text)

      expect(missingLines('input-refused', { field: 'port' })).toEqual([])
      expect(normalize(modal().textContent ?? '')).toContain('65535')
      expect(provisioning.probeRequests).toEqual([])
      expect(log.calls).toEqual([])
    },
  )

  it('opens the offer prefilled with a port that answers, and closes the message (TC10, AC08.3)', async () => {
    provisioning.answerSshOn(2222)
    openNoDevice()
    renderModalAndDialog()

    await tryPort('2222')
    await act(() => settle(() => slice().view.stage === 'offer'))

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 2222 }])
    expect(modalShown()).toBe(false)
    expect(input('runtime-provisioning-ssh-port').value).toBe('2222')
    expect(provisioning.runRequests).toEqual([])
  })

  it('disables the check button while the check runs, and enables it again after', async () => {
    const pendingProbes: ((result: SshProbeResult) => void)[] = []
    const slowProvisioning: RuntimeProvisioningPort = {
      ...provisioning.port,
      probeSsh: (request) => {
        log.calls.push(`provisioning.probeSsh ${request.host}:${request.port}`)
        return new Promise<SshProbeResult>((resolve) => {
          pendingProbes.push(resolve)
        })
      },
    }
    openNoDevice()
    renderModal(createPlatformPorts(log, { runtime: runtime.port, device, runtimeProvisioning: slowProvisioning }))

    await tryPort('2222')
    await act(() => settle(() => pendingProbes.length === 1))
    const disabledWhileChecking = button('runtime-no-device-try-port').disabled
    await act(async () => {
      pendingProbes[0]({ answered: false, reason: 'timeout' })
      await settle(() => noDeviceSshPort() === 2222)
    })
    await waitFor(() => {
      expect(button('runtime-no-device-try-port').disabled).toBe(false)
    })

    expect(disabledWhileChecking).toBe(true)
    expect(noDeviceState()).toEqual({ open: true, data: { host: DEVICE_IP, sshPort: 2222 } })
  })
})

describe('the "Try another SSH port" label (AC08.3)', () => {
  it('is dark in the light theme and white in the dark theme, like the other labels', () => {
    openNoDevice()
    renderModal()

    const label = within(modal()).getByText('Try another SSH port', { selector: 'label' })

    expect(textColourClasses(label)).toEqual(['dark:text-white', 'text-neutral-950'])
  })
})

describe('closing the "No recognized device" message', () => {
  const CLOSE_ACTIONS: [string, () => void][] = [
    [
      'OK',
      () => {
        fireEvent.click(within(modal()).getByRole('button', { name: /^ok$/i }))
      },
    ],
    [
      'the X',
      () => {
        fireEvent.click(closeIconButton(modal()))
      },
    ],
    [
      'Escape',
      () => {
        fireEvent.keyDown(modal(), { key: 'Escape' })
      },
    ],
  ]

  it.each(CLOSE_ACTIONS)('closes on %s, contacts nothing and stays disconnected', (_action, close) => {
    openNoDevice()
    renderModal()

    act(close)

    expect(modalShown()).toBe(false)
    expect(noDeviceState().open).toBe(false)
    expect(connectionStatus(store)).toBe('disconnected')
    expect(slice().view).toEqual({ stage: 'idle' })
    expect(log.calls).toEqual([])
  })
})
