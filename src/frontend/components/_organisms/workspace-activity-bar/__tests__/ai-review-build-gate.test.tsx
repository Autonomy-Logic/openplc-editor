import type { OpenPLCStore } from '@root/frontend/store'
import type { AIPendingReview } from '@root/frontend/store/slices/ai/types'
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

const REFUSAL = 'The AI assistant has changes waiting for review. Keep or undo them in the AI chat before building.'

const BOARD_NAME = 'OpenPLC Runtime'
const BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const compileProgram = vi.fn(() => Promise.resolve({ success: true }))
const compileForDebug = vi.fn(() => Promise.resolve({ success: true }))
const setPlcState = vi.fn(() => Promise.resolve({ success: true }))
const projectCalls: string[] = []

let store: OpenPLCStore

function openReview() {
  const { project, tabs, selectedTab, editors, editor, ladderFlows, fbdFlows, libraries, files } = store.getState()
  const review: AIPendingReview = {
    checkpoint: {
      projectData: structuredClone(project.data),
      tabs: structuredClone(tabs),
      selectedTab,
      editors: structuredClone(editors),
      editor: structuredClone(editor),
      ladderFlows: structuredClone(ladderFlows),
      fbdFlows: structuredClone(fbdFlows),
      libraries: structuredClone(libraries),
      files: structuredClone(files),
    },
    hasNonDiffMutation: true,
  }
  store.getState().aiActions.openAIReview(review)
}

function renderBar(options: { canEdit?: boolean; plcRunning?: boolean } = {}) {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD_NAME, BOARD]]) })
  deviceActions.setDeviceBoard(BOARD_NAME)
  deviceActions.setSelectedDevice(null)
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setDeviceConnectionStatus('connected')
  if (options.plcRunning) deviceActions.setPlcRuntimeStatus('RUNNING')
  workspaceActions.setCanEdit(options.canEdit ?? false)
  consoleActions.clearLogs()

  const ports: PlatformPorts = {
    compiler: stubPort({ compileProgram, compileForDebug }),
    runtime: stubPort(),
    debugger: stubPort({
      setPlcState,
      readProgramMd5: () => Promise.resolve({ success: true, md5: 'local-md5' }),
      connect: () => Promise.resolve({ success: true }),
      verifyMd5: () => Promise.resolve({ success: true, match: false, targetMd5: 'device-md5' }),
      disconnect: () => Promise.resolve({ success: true }),
    }),
    simulator: stubPort(),
    project: new Proxy({} as PlatformPorts['project'], {
      get(_target, prop) {
        return (): undefined => {
          if (typeof prop === 'string') projectCalls.push(prop)
          return undefined
        }
      },
    }),
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

function loggedMessages() {
  return store.getState().logs.map((entry) => entry.message)
}

/** Answers the open device dialog, or null while none is open. */
function deviceDialog(): ((buttonIndex: number) => void) | null {
  const { open, data } = store.getState().modalActions.getModalState('debugger-message')
  if (!open || typeof data !== 'object' || data === null || !('onResponse' in data)) return null
  const { onResponse } = data
  if (typeof onResponse !== 'function') return null
  return (buttonIndex) => {
    onResponse(buttonIndex)
  }
}

describe('Build and upload refuse unreviewed AI changes', () => {
  beforeEach(() => {
    compileProgram.mockClear()
    compileForDebug.mockClear()
    setPlcState.mockClear()
    projectCalls.length = 0
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('refuses to build while an AI review is open', async () => {
    openReview()
    renderBar()

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('refuses to build while an AI turn is still running', async () => {
    store.getState().aiActions.setAgenticLoopRunning(true)
    renderBar()

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('builds once the review is closed', async () => {
    openReview()
    store.getState().aiActions.closeAIReview()
    renderBar()

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('rechecks after the stop-PLC dialog, before stopping the PLC', async () => {
    renderBar({ plcRunning: true })

    chooseBuildOption('Build and upload')
    await waitFor(() => expect(deviceDialog()).not.toBeNull())
    openReview()
    deviceDialog()?.(1)

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(setPlcState).not.toHaveBeenCalled()
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('refuses to start the debugger before its pre-save writes the project', async () => {
    openReview()
    renderBar({ canEdit: true })

    fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(projectCalls).toEqual([])
    expect(compileForDebug).not.toHaveBeenCalled()
  })

  it('rechecks after the mismatch upload is accepted, before uploading', async () => {
    renderBar()

    fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))
    await waitFor(() => expect(deviceDialog()).not.toBeNull())
    openReview()
    deviceDialog()?.(0)

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(compileProgram).not.toHaveBeenCalled()
  })
})
