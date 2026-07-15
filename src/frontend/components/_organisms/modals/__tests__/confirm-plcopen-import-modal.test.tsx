import { fireEvent, render, screen } from '@testing-library/react'

const mockProjectPort = { id: 'fake-project-port' }
vi.mock('../../../../../middleware/shared/providers', () => ({
  useProject: () => mockProjectPort,
}))

const mockExecuteImportPlcopen = vi.fn()
vi.mock('../../../../services/import-actions', () => ({
  executeImportPlcopen: (...args: unknown[]) => mockExecuteImportPlcopen(...args),
}))

const closeModal = vi.fn()
const onOpenChange = vi.fn()
vi.mock('../../../../store', () => ({
  useOpenPLCStore: () => ({
    modalActions: { onOpenChange, closeModal },
  }),
}))

import { ConfirmPlcopenImportModal } from '../confirm-plcopen-import-modal'

describe('ConfirmPlcopenImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteImportPlcopen.mockResolvedValue({ success: true })
  })

  it('renders the overwrite warning copy when open', () => {
    render(<ConfirmPlcopenImportModal isOpen />)
    expect(screen.getByText('Import PLCopen XML?')).toBeTruthy()
    expect(
      screen.getByText('Importing a PLCopen XML file will overwrite the entire currently open project. This cannot be undone.'),
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

    expect(mockExecuteImportPlcopen).toHaveBeenCalledWith(mockProjectPort)
    expect(closeModal).toHaveBeenCalledTimes(1)
  })

  it('closes without importing on cancel', () => {
    render(<ConfirmPlcopenImportModal isOpen />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(mockExecuteImportPlcopen).not.toHaveBeenCalled()
    expect(closeModal).toHaveBeenCalledTimes(1)
  })
})
