/**
 * Every upload to an unlicensed runtime target ends with the GPLv3 disclaimer
 * in the console, as a warning framed by rules of asterisks; nothing else does.
 */
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import {
  COMMERCIAL_LICENSE_DISCLAIMER,
  commercialLicenseConsoleLines,
  type TargetCommercialLicenseStatus,
} from '@root/middleware/shared/utils/licensing'
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

const BOARD_NAME = 'OpenPLC Runtime'
const BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const compileProgram = jest.fn((): Promise<{ success: boolean; error?: string }> => Promise.resolve({ success: true }))

let store: OpenPLCStore

function renderBar(status: TargetCommercialLicenseStatus | null) {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD_NAME, BOARD]]) })
  deviceActions.setDeviceBoard(BOARD_NAME)
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setRuntimeCommercialLicenseStatus(status)
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports: PlatformPorts = {
    compiler: stubPort({ compileProgram }),
    runtime: stubPort(),
    debugger: stubPort(),
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

describe('Build and upload — runtime commercial licence warning', () => {
  beforeEach(() => {
    compileProgram.mockClear()
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('ends an upload to an unlicensed target with the framed disclaimer', async () => {
    renderBar('unlicensed')
    chooseBuildOption('Build and upload')
    await waitFor(() => expect(warnings()).toContain(COMMERCIAL_LICENSE_DISCLAIMER))
    expect(warnings().slice(-3)).toEqual(commercialLicenseConsoleLines())
    expect(compileProgram).toHaveBeenCalledWith(expect.objectContaining({ compileOnly: false }), expect.any(Function))
  })

  it('prints nothing for a licensed target, an unknown status or a paid VPP', async () => {
    for (const status of ['licensed', 'unknown', 'vpp-flow', null] as const) {
      cleanup()
      store = createTestStore()
      renderBar(status)
      chooseBuildOption('Build and upload')
      await waitFor(() => expect(compileProgram).toHaveBeenCalled())
      await waitFor(() => expect(store.getState().logs.length).toBeGreaterThan(0))
      expect(warnings()).not.toContain(COMMERCIAL_LICENSE_DISCLAIMER)
      compileProgram.mockClear()
    }
  })

  it('prints nothing for a compile-only build or a failed upload', async () => {
    renderBar('unlicensed')
    chooseBuildOption('Build only')
    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(warnings()).not.toContain(COMMERCIAL_LICENSE_DISCLAIMER)

    cleanup()
    store = createTestStore()
    compileProgram.mockClear()
    compileProgram.mockResolvedValueOnce({ success: false, error: 'upload failed' })
    renderBar('unlicensed')
    chooseBuildOption('Build and upload')
    await waitFor(() => expect(store.getState().logs.map((entry) => entry.message)).toContain('upload failed'))
    expect(warnings()).not.toContain(COMMERCIAL_LICENSE_DISCLAIMER)
  })
})
