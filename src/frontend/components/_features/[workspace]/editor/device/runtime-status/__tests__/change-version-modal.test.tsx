/**
 * The version picker (RTOP-283).
 *
 * A free-text field here was a real defect, not a cosmetic one: a version that
 * does not exist is only rejected minutes later, by the device, in the
 * daemon's words -- and a valid-looking tag against a misconfigured repository
 * produces a message that blames the tag. These tests pin the list, the
 * marking of what is already installed, and the offline fallback that keeps a
 * side-loaded image installable.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const startUpdate = vi.fn()
const getUpdateProgress = vi.fn()

vi.mock('@root/middleware/shared/providers/platform-context', () => ({
  useRuntime: () => ({
    bootloader: { startUpdate, getUpdateProgress, clearSession: vi.fn() },
  }),
}))

const listRuntimeVersions = vi.fn()
vi.mock('@root/middleware/shared/utils/runtime-versions', () => ({
  listRuntimeVersions: (...args: unknown[]) => listRuntimeVersions(...args),
  clearRuntimeVersionsCache: vi.fn(),
}))

import { ChangeVersionModal } from '../change-version-modal'

const TAGS = [
  { tag: 'v4.2.1', prerelease: false },
  { tag: 'v4.2.0', prerelease: false },
  { tag: 'v4.1.10', prerelease: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  getUpdateProgress.mockResolvedValue({ success: false, error: 'idle' })
  listRuntimeVersions.mockResolvedValue({ ok: true, versions: TAGS })
})

describe('Change Runtime Version', () => {
  it('offers the published versions instead of an empty field', async () => {
    render(<ChangeVersionModal open currentVersion='v4.2.0' onOpenChange={vi.fn()} />)

    const trigger = await screen.findByRole('combobox', { name: /runtime version to install/i })
    await userEvent.click(trigger)

    // Every published tag is reachable -- including v4.1.10, whose two-digit
    // patch has to sort above v4.1.9 rather than below it.
    for (const { tag } of TAGS) {
      expect(await screen.findByText(new RegExp(`^${tag.replace('.', '\\.')}`))).toBeTruthy()
    }
  })

  it('marks the version already installed', async () => {
    render(<ChangeVersionModal open currentVersion='v4.2.0' onOpenChange={vi.fn()} />)
    await userEvent.click(await screen.findByRole('combobox'))
    expect(await screen.findByText('v4.2.0 (installed)')).toBeTruthy()
  })

  it('sends the chosen tag to the device verbatim', async () => {
    startUpdate.mockResolvedValue({ success: true, data: { state: 'pulling', to: 'v4.1.10' } })
    render(<ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} />)

    await userEvent.click(await screen.findByRole('combobox'))
    await userEvent.click(await screen.findByText('v4.1.10'))
    await userEvent.click(screen.getByRole('button', { name: /install/i }))

    await waitFor(() => expect(startUpdate).toHaveBeenCalledWith('v4.1.10'))
  })

  it('will not install the version already running', async () => {
    render(<ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} />)
    await userEvent.click(await screen.findByRole('combobox'))
    await userEvent.click(await screen.findByText('v4.2.1 (installed)'))

    expect(screen.getByRole('button', { name: /install/i }).hasAttribute('disabled')).toBe(true)
    expect(startUpdate).not.toHaveBeenCalled()
  })

  it('still lets a version be typed when the list cannot be read', async () => {
    // An offline device holding a side-loaded image is a version that can be
    // installed; refusing to offer the field would make it unreachable.
    listRuntimeVersions.mockResolvedValue({ ok: false, error: 'Could not reach GitHub.' })
    startUpdate.mockResolvedValue({ success: true, data: { state: 'pulling', to: 'v4.0.9' } })

    render(<ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} />)

    const field = await screen.findByRole('textbox', { name: /runtime version to install/i })
    await waitFor(() => expect(screen.getByText(/could not reach github/i)).toBeTruthy())

    await userEvent.type(field, 'v4.0.9')
    await userEvent.click(screen.getByRole('button', { name: /install/i }))
    await waitFor(() => expect(startUpdate).toHaveBeenCalledWith('v4.0.9'))
  })
})
