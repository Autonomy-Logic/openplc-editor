/**
 * The debugger's mismatch re-upload hands a held serial link's port to the
 * upload and reconnects afterwards, as Build & Upload does. It used to compile
 * straight past the handoff, so a USB board's upload failed on a busy port.
 */
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
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

const BOARD_NAME = 'ESP32 WROOM'
const PORT = '/dev/ttyUSB0'

const USB_BOARD: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'esp32:esp32',
  preview: 'esp32.png',
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

const compileForDebug = jest.fn(() => Promise.resolve({ success: true }))
const compileProgram = jest.fn((): Promise<{ success: boolean; error?: string }> => Promise.resolve({ success: true }))
const verifyMd5 = jest.fn(() => Promise.resolve({ success: true, match: false, targetMd5: 'device-md5' }))
const releaseSerialPort = jest.fn(() => Promise.resolve(true))
const deviceConnect = jest.fn(() => Promise.resolve({ status: 'connected-with-firmware' as const }))

let store: OpenPLCStore

function renderBar() {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD_NAME, USB_BOARD]]) })
  deviceActions.setDeviceBoard(BOARD_NAME)
  deviceActions.setCommunicationPort(PORT)
  deviceActions.setDeviceConnectionStatus('connected', PORT)
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports: PlatformPorts = {
    compiler: stubPort({ compileForDebug, compileProgram }),
    runtime: stubPort(),
    debugger: stubPort({
      readProgramMd5: () => Promise.resolve({ success: true, md5: 'local-md5' }),
      connect: () => Promise.resolve({ success: true }),
      verifyMd5,
      disconnect: () => Promise.resolve({ success: true }),
    }),
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

/** Answers the open "Upload the current project?" prompt, or null while none is open. */
function uploadPrompt(): ((buttonIndex: number) => void) | null {
  const { open, data } = store.getState().modalActions.getModalState('debugger-message')
  if (!open || typeof data !== 'object' || data === null || !('onResponse' in data)) return null
  const { onResponse } = data
  if (typeof onResponse !== 'function') return null
  return (buttonIndex) => {
    onResponse(buttonIndex)
  }
}

describe('MD5 re-upload — serial handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('releases the held port, uploads, reconnects, then verifies the MD5 again', async () => {
    verifyMd5
      .mockResolvedValueOnce({ success: true, match: false, targetMd5: 'device-md5' })
      .mockResolvedValueOnce({ success: true, match: true, targetMd5: 'local-md5' })
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))
    await waitFor(() => expect(uploadPrompt()).not.toBeNull())
    uploadPrompt()?.(0)

    await waitFor(() => expect(deviceConnect).toHaveBeenCalled())
    expect(releaseSerialPort).toHaveBeenCalledWith(PORT)
    expect(compileProgram).toHaveBeenCalledWith(
      expect.objectContaining({ compileOnly: false, communicationPort: PORT }),
      expect.any(Function),
    )
    const [released] = releaseSerialPort.mock.invocationCallOrder
    const [uploaded] = compileProgram.mock.invocationCallOrder
    const [reconnected] = deviceConnect.mock.invocationCallOrder
    expect(released).toBeLessThan(uploaded)
    expect(uploaded).toBeLessThan(reconnected)
    // The re-check waits 2 s for the board to boot the new firmware.
    await waitFor(() => expect(verifyMd5).toHaveBeenCalledTimes(2), { timeout: 5000 })
    expect(verifyMd5.mock.invocationCallOrder[1]).toBeGreaterThan(reconnected)
  })

  it('reports a failed upload and does not verify again', async () => {
    compileProgram.mockResolvedValueOnce({ success: false, error: 'upload failed' })
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))
    await waitFor(() => expect(uploadPrompt()).not.toBeNull())
    uploadPrompt()?.(0)

    await waitFor(() =>
      expect(store.getState().logs.map((entry) => entry.message)).toContain(
        'Upload failed: the program was not uploaded.',
      ),
    )
    expect(compileForDebug).toHaveBeenCalledTimes(1)
    expect(verifyMd5).toHaveBeenCalledTimes(1)
  })
})
