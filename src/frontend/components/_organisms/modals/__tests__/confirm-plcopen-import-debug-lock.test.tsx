import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../../../middleware/shared/ports/project-port'
import type { PlatformPorts } from '../../../../../middleware/shared/providers/types'
import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { ConfirmPlcopenImportModal } from '../confirm-plcopen-import-modal'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

let pickCalls = 0
let store: OpenPLCStore

const pickPlcopenImportFile: ProjectPort['pickPlcopenImportFile'] = () => {
  pickCalls += 1
  return Promise.resolve({ success: false })
}

const makePorts = (): PlatformPorts => ({
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort<ProjectPort>({ pickPlcopenImportFile }),
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
})

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store, makePorts()) })

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const confirm = async () => {
  fireEvent.click(screen.getByText('Import PLCopen XML'))
  await act(() => Promise.resolve())
}

describe('ConfirmPlcopenImportModal during a debug session (TC19)', () => {
  beforeEach(() => {
    pickCalls = 0
    store = createTestStore()
  })

  it('should ask for the file when no debug session is open', async () => {
    render(<ConfirmPlcopenImportModal isOpen />)

    await confirm()

    expect(pickCalls).toBe(1)
  })

  it('should never reach the file picker while the debugger is open', async () => {
    openDebugSession()
    render(<ConfirmPlcopenImportModal isOpen />)

    await confirm()

    expect(pickCalls).toBe(0)
  })

  it('should close itself when it refuses the import', async () => {
    openDebugSession()
    render(<ConfirmPlcopenImportModal isOpen />)

    await confirm()

    expect(store.getState().modals['confirm-plcopen-import'].open).toBe(false)
  })
})
