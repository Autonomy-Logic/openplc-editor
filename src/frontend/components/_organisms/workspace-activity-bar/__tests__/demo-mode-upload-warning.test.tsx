/**
 * Every upload to a licensable device whose last license check found no license
 * ends with the demo-mode notice in the console, framed by rules of asterisks.
 */
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { DeviceLicenseState } from '@root/middleware/shared/ports/device-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { demoModeConsoleLines } from '@root/middleware/shared/utils/licensing'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

function stubPort<T extends object>(overrides: Partial<NoInfer<T>> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

type Target = 'runtime-v4' | 'arduino-serial'

const RUNTIME_BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }
const SERIAL_PORT = '/dev/ttyACM0'
const SERIAL_BOARD: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'rp2040:rp2040',
  preview: 'aralalta.png',
  specs: {},
  debug: {
    channels: [
      {
        label: 'Modbus RTU',
        channel: 'rtu',
        enabledWhen: true,
        params: { port: { $ref: 'configuration.communicationPort' }, baudRate: 115200, slaveId: 1 },
      },
    ],
  },
}

const BOARDS: Record<Target, [string, BoardInfo]> = {
  'runtime-v4': ['OpenPLC Runtime', RUNTIME_BOARD],
  'arduino-serial': ['X-Peak Aralalta', SERIAL_BOARD],
}

const compileProgram = jest.fn((): Promise<{ success: boolean; error?: string }> => Promise.resolve({ success: true }))
const releaseSerialPort = jest.fn(() => Promise.resolve(true))
const deviceConnect = jest.fn(() => Promise.resolve({ status: 'connected-with-firmware' as const }))

let store: OpenPLCStore

function renderBar(outcome: DeviceLicenseState | null, target: Target = 'runtime-v4') {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  const [boardName, board] = BOARDS[target]
  deviceActions.setAvailableOptions({ availableBoards: new Map([[boardName, board]]) })
  deviceActions.setDeviceBoard(boardName)
  if (target === 'runtime-v4') deviceActions.setRuntimeConnectionStatus('connected')
  if (target === 'arduino-serial') {
    deviceActions.setCommunicationPort(SERIAL_PORT)
    deviceActions.setDeviceConnectionStatus('connected', SERIAL_PORT)
  }
  if (outcome) deviceActions.setDeviceLicenseReport({ deviceId: '659a3520540f803625ddc34081e893d3', outcome })
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports: PlatformPorts = {
    compiler: stubPort({ compileProgram }),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort({ releaseSerialPort, connect: deviceConnect }),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
  }
  render(<DefaultWorkspaceActivityBar />, { wrapper: createStoreWrapper(store, ports) })
}

function chooseBuildOption(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Build options' }))
  const row = screen.getByText(label).closest('button')
  if (!row) throw new Error(`build option "${label}" rendered without a button`)
  fireEvent.click(row)
}

const warnings = () =>
  store
    .getState()
    .logs.filter((entry) => entry.level === 'warning')
    .map((entry) => entry.message)

const framed = demoModeConsoleLines()

describe('Build and upload — demo-mode warning', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  const NO_LICENSE: [string, DeviceLicenseState][] = [
    ['no license on record', { state: 'unlicensed', entitlementChecked: true }],
    ['no license stored', { state: 'unlicensed', entitlementChecked: false }],
    ['no license storage in the firmware', { state: 'unsupported' }],
  ]

  describe.each<Target>(['runtime-v4', 'arduino-serial'])('on a %s target', (target) => {
    it.each(NO_LICENSE)(
      'ends an upload with the framed notice when the last check found %s',
      async (_label, outcome) => {
        renderBar(outcome, target)
        chooseBuildOption('Build and upload')
        await waitFor(() => expect(warnings().slice(-framed.length)).toEqual(framed))
        expect(compileProgram).toHaveBeenCalledWith(
          expect.objectContaining({ compileOnly: false }),
          expect.any(Function),
        )
      },
    )
  })

  it('releases and reconnects the serial link around the upload and still warns', async () => {
    renderBar({ state: 'unlicensed', entitlementChecked: true }, 'arduino-serial')
    chooseBuildOption('Build and upload')
    await waitFor(() => expect(warnings().slice(-framed.length)).toEqual(framed))
    expect(releaseSerialPort).toHaveBeenCalledWith(SERIAL_PORT)
  })

  it('prints it again on every upload, not only the first', async () => {
    renderBar({ state: 'unlicensed', entitlementChecked: true })
    chooseBuildOption('Build and upload')
    await waitFor(() => expect(compileProgram).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(warnings().filter((line) => line === framed[1])).toHaveLength(1))
    chooseBuildOption('Build and upload')
    await waitFor(() => expect(compileProgram).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(warnings().filter((line) => line === framed[1])).toHaveLength(2))
  })

  it('prints nothing for a licensed device, a failed check or a device never checked', async () => {
    const outcomes: (DeviceLicenseState | null)[] = [
      { state: 'licensed', how: 'already-stored' },
      { state: 'check-failed', error: 'The license server did not answer in time.' },
      null,
    ]
    for (const outcome of outcomes) {
      cleanup()
      store = createTestStore()
      compileProgram.mockClear()
      renderBar(outcome)
      chooseBuildOption('Build and upload')
      await waitFor(() => expect(compileProgram).toHaveBeenCalled())
      await waitFor(() => expect(store.getState().logs.length).toBeGreaterThan(0))
      expect(warnings()).not.toContain(framed[1])
    }
  })

  it('prints nothing for a compile-only build or a failed upload', async () => {
    renderBar({ state: 'unlicensed', entitlementChecked: true })
    chooseBuildOption('Build only')
    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(warnings()).not.toContain(framed[1])

    cleanup()
    store = createTestStore()
    compileProgram.mockClear()
    compileProgram.mockResolvedValueOnce({ success: false, error: 'upload failed' })
    renderBar({ state: 'unlicensed', entitlementChecked: true })
    chooseBuildOption('Build and upload')
    await waitFor(() => expect(store.getState().logs.map((entry) => entry.message)).toContain('upload failed'))
    expect(warnings()).not.toContain(framed[1])
  })
})
