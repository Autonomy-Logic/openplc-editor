import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

const mockExecuteImportPlcopen = vi.fn()
vi.mock('../../../../services/import-actions', () => ({
  executeImportPlcopen: (...args: unknown[]) => mockExecuteImportPlcopen(...args),
}))

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

const mockProjectPort = stubPort<ProjectPort>()

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: mockProjectPort,
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

let store: OpenPLCStore
let closeModal = vi.fn()

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store, ports) })

describe('ConfirmPlcopenImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteImportPlcopen.mockResolvedValue({ success: true })
    store = createTestStore()
    const { modalActions } = store.getState()
    // Store state is frozen by Immer, so the action is swapped in rather than spied on.
    closeModal = vi.fn(() => modalActions.closeModal())
    store.setState({ modalActions: { ...modalActions, closeModal } })
  })

  it('renders the overwrite warning copy when open', () => {
    render(<ConfirmPlcopenImportModal isOpen />)
    expect(screen.getByText('Import PLCopen XML?')).toBeTruthy()
    expect(
      screen.getByText(
        'Importing a PLCopen XML file will overwrite the entire currently open project. This cannot be undone.',
      ),
    ).toBeTruthy()
  })

  it('renders nothing visible when closed', () => {
    render(<ConfirmPlcopenImportModal isOpen={false} />)
    expect(screen.queryByText('Import PLCopen XML?')).toBeNull()
  })

  it('calls executeImportPlcopen with the project port and closes the modal on confirm', async () => {
    render(<ConfirmPlcopenImportModal isOpen />)

    fireEvent.click(screen.getByText('Import PLCopen XML'))

    // Flush the async handler.
    await Promise.resolve()
    await Promise.resolve()

    expect(mockExecuteImportPlcopen).toHaveBeenCalledWith(store, mockProjectPort)
    expect(closeModal).toHaveBeenCalledTimes(1)
  })

  it('closes without importing on cancel', () => {
    render(<ConfirmPlcopenImportModal isOpen />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(mockExecuteImportPlcopen).not.toHaveBeenCalled()
    expect(closeModal).toHaveBeenCalledTimes(1)
  })
})
