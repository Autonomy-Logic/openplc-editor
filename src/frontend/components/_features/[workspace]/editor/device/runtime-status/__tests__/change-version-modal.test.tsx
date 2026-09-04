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

const setRuntimeUpdateInProgress = vi.fn()
vi.mock('@root/frontend/store', () => ({
  useOpenPLCStore: (selector: (state: unknown) => unknown) =>
    selector({ deviceActions: { setRuntimeUpdateInProgress } }),
}))

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

describe('Following an update', () => {
  /**
   * The bug this pins down took the whole app out, not just this dialog.
   *
   * `onFinished` is passed as an inline arrow, so it is a new function on
   * every parent render. It was a dependency of `poll`, which was a
   * dependency of the effect that starts the poll timer -- and that effect
   * assigned `pollingRef.current` without clearing what was there, while its
   * cleanup only set a `cancelled` flag. So each parent render started
   * another timer and abandoned the last one. Each timer's tick re-rendered
   * the parent, which started another: the count compounded until the app was
   * firing hundreds of requests a second, the dev server returned 503 to
   * everything, and the editor looked dead.
   */
  it('keeps exactly one poll loop no matter how often the parent re-renders', async () => {
    vi.useFakeTimers()
    try {
      getUpdateProgress.mockResolvedValue({ success: true, data: { state: 'pulling', to: 'v4.1.10' } })

      const { rerender } = render(
        <ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} onFinished={() => undefined} />,
      )
      await vi.advanceTimersByTimeAsync(0)

      // Re-render the way the real parent does: a fresh callback each time.
      for (let render_ = 0; render_ < 10; render_ += 1) {
        rerender(
          <ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} onFinished={() => undefined} />,
        )
        await vi.advanceTimersByTimeAsync(0)
      }

      getUpdateProgress.mockClear()
      // Three intervals of a single loop. With the timers stacking, ten
      // re-renders made this an order of magnitude larger.
      await vi.advanceTimersByTimeAsync(3 * 1500)

      expect(getUpdateProgress.mock.calls.length).toBeLessThanOrEqual(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the status poller to stand down when an update starts', async () => {
    // getUpdateProgress stays idle (the beforeEach default): an in-flight
    // state at mount is adopted, which disables the picker before it can be
    // used.
    startUpdate.mockResolvedValue({ success: true, data: { state: 'pulling', to: 'v4.1.10' } })

    render(<ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} />)
    await userEvent.click(await screen.findByRole('combobox'))
    await userEvent.click(await screen.findByText('v4.1.10'))
    await userEvent.click(screen.getByRole('button', { name: /install/i }))

    await waitFor(() => expect(setRuntimeUpdateInProgress).toHaveBeenCalledWith(true))
  })

  it('lets the poller resume once the dialog is gone', async () => {
    // A flag left raised would disable status polling for the rest of the
    // session, which is a quieter failure than the one it prevents.
    const { unmount } = render(<ChangeVersionModal open currentVersion='v4.2.1' onOpenChange={vi.fn()} />)
    unmount()
    expect(setRuntimeUpdateInProgress).toHaveBeenCalledWith(false)
  })
})
