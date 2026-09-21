import { openPLCStoreBase } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

// `NoInfer` pins T to the port the result is assigned to: ts-jest type-checks
// this file, so an inferred literal would not satisfy the port interface.
function stubPort<T extends object>(overrides: Partial<NoInfer<T>> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const PLAIN_BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const VPP_BOARD: BoardInfo = {
  ...PLAIN_BOARD,
  vpp: {
    packageId: 'com.acme.backplane',
    vendor: 'Acme',
    deviceId: 'slm-rp4',
    packagePath: '/packages/com.acme.backplane',
    screens: {},
    moduleSystem: null,
  },
}

const REFUSAL =
  'This vPLC has no access to the local backplane I/O. Create a vPLC with that option, or select the one that has it.'

const VPP_BOARD_NAME = 'Acme SLM-RP4'
const PLAIN_BOARD_NAME = 'OpenPLC Runtime'

const holder: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-holder',
  deviceName: 'Line A',
  backplaneAccess: true,
}

const compileForDebug = vi.fn(() => Promise.resolve({ success: true }))
// The re-upload is what this spec watches, never what it exercises: failing it
// ends the handler instead of recursing into a second MD5 round.
const compileProgram = vi.fn(() => Promise.resolve({ success: false, error: 'upload not exercised' }))

function renderBar(board: string, selectedDevice: SelectedDevice | null) {
  const { deviceActions, workspaceActions, consoleActions } = openPLCStoreBase.getState()
  deviceActions.setAvailableOptions({
    availableBoards: new Map([
      [PLAIN_BOARD_NAME, PLAIN_BOARD],
      [VPP_BOARD_NAME, VPP_BOARD],
    ]),
  })
  deviceActions.setDeviceBoard(board)
  deviceActions.setSelectedDevice(selectedDevice)
  // A debug session refuses to start without one, and the MD5 round only runs
  // after it has started.
  deviceActions.setDeviceConnectionStatus('connected')
  // A viewer skips the pre-debug save; nothing here is testing the save.
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports: PlatformPorts = {
    compiler: stubPort({ compileForDebug, compileProgram }),
    runtime: stubPort(),
    debugger: stubPort({
      readProgramMd5: () => Promise.resolve({ success: true, md5: 'local-md5' }),
      connect: () => Promise.resolve({ success: true }),
      // The mismatch is the whole point: it is the branch that offers an upload.
      verifyMd5: () => Promise.resolve({ success: true, match: false, targetMd5: 'device-md5' }),
      disconnect: () => Promise.resolve({ success: true }),
    }),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: WEB_CAPABILITIES,
  }
  render(
    <PlatformProvider ports={ports}>
      <DefaultWorkspaceActivityBar />
    </PlatformProvider>,
  )
}

function debuggerButton(): HTMLButtonElement {
  const control = screen.getByRole('button', { name: 'Debugger' })
  if (!(control instanceof HTMLButtonElement)) throw new Error('the Debugger control is not a button')
  return control
}

function startDebugSession() {
  fireEvent.click(debuggerButton())
}

function loggedMessages() {
  return openPLCStoreBase.getState().logs.map((entry) => entry.message)
}

/**
 * Answers the "Upload the current project?" prompt, or null while the mismatch
 * branch has not offered it. The modal slice carries an untyped payload, so this
 * narrows it rather than asserting a shape onto it.
 */
function uploadPrompt(): ((buttonIndex: number) => void) | null {
  const { open, data } = openPLCStoreBase.getState().modalActions.getModalState('debugger-message')
  if (!open || typeof data !== 'object' || data === null || !('onResponse' in data)) return null
  const { onResponse } = data
  if (typeof onResponse !== 'function') return null
  return (buttonIndex) => {
    onResponse(buttonIndex)
  }
}

describe('MD5 re-upload — backplane gate', () => {
  beforeEach(() => {
    compileForDebug.mockClear()
    compileProgram.mockClear()
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
    openPLCStoreBase.getState().deviceActions.clearDeviceConnection()
    openPLCStoreBase.getState().modalActions.closeModal()
  })

  afterEach(() => {
    cleanup()
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
    openPLCStoreBase.getState().deviceActions.clearDeviceConnection()
    openPLCStoreBase.getState().modalActions.closeModal()
    openPLCStoreBase.getState().workspaceActions.setCanEdit(true)
  })

  it('refuses the mismatch re-upload of a vendor-package board to a vPLC without backplane access', async () => {
    renderBar(VPP_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    startDebugSession()

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    // Compiling with `compileOnly: false` is the upload, so "never compiled" is
    // "nothing reached the runtime".
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('does not even offer the upload it would refuse', async () => {
    renderBar(VPP_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    startDebugSession()

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(uploadPrompt()).toBeNull()
  })

  it('leaves the debugger idle after refusing, so a second attempt is possible', async () => {
    renderBar(VPP_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    startDebugSession()
    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))

    // `isDebuggerProcessing` disables the button while a round is in flight; the
    // refusal has to release it exactly as declining the upload would.
    await waitFor(() => expect(debuggerButton().disabled).toBe(false))
    startDebugSession()
    await waitFor(() => expect(compileForDebug).toHaveBeenCalledTimes(2))
  })

  it('uploads on mismatch to the vPLC that holds the backplane', async () => {
    renderBar(VPP_BOARD_NAME, holder)

    startDebugSession()

    await waitFor(() => expect(uploadPrompt()).not.toBeNull())
    uploadPrompt()?.(0)

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('uploads on mismatch when the host reported no flag at all', async () => {
    renderBar(VPP_BOARD_NAME, {
      orchestratorId: 'orch-1',
      orchestratorAgentId: 'agent-1',
      deviceId: 'dev-old',
      deviceName: 'Line C',
    })

    startDebugSession()

    await waitFor(() => expect(uploadPrompt()).not.toBeNull())
    uploadPrompt()?.(0)

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('uploads an ordinary board on mismatch to a vPLC without backplane access', async () => {
    renderBar(PLAIN_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    startDebugSession()

    await waitFor(() => expect(uploadPrompt()).not.toBeNull())
    uploadPrompt()?.(0)

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('uploads an ordinary board on mismatch when no vPLC is the target', async () => {
    renderBar(PLAIN_BOARD_NAME, null)

    startDebugSession()

    await waitFor(() => expect(uploadPrompt()).not.toBeNull())
    uploadPrompt()?.(0)

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  // Same rule as the build path, in the same words: a vendor board comes from
  // the package a vPLC was created with, so there is nothing to upload it to.
  it('refuses a vendor board on mismatch when no vPLC is the target', async () => {
    renderBar(VPP_BOARD_NAME, null)

    startDebugSession()

    await waitFor(() =>
      expect(loggedMessages().some((message) => message.startsWith('Select a vPLC before building'))).toBe(true),
    )
    expect(compileProgram).not.toHaveBeenCalled()
  })
})
