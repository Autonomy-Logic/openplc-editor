import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OrchestratorPort } from '@root/middleware/shared/ports/orchestrator-port'
import type { PackagePort } from '@root/middleware/shared/ports/package-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { VppTargetLoadState } from '@root/middleware/shared/ports/vpp-target-mechanisms'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { OrchestratorsList } from '../orchestrators-list'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

type LoadListener = (state: VppTargetLoadState) => void
type ErrorReason = Extract<VppTargetLoadState, { status: 'error' }>['reason']

/** Longer than any tooltip open delay, so a hovered trigger has opened its tooltip. */
const TOOLTIP_OPEN_MS = 2_000

const DOWNLOADING: VppTargetLoadState = { status: 'downloading', loaded: 4_200_000, total: 11_100_000 }
const NO_TOTAL: VppTargetLoadState = { status: 'downloading', loaded: 4_200_000, total: null }
const VERIFYING: VppTargetLoadState = { status: 'verifying' }
const STALLED: VppTargetLoadState = { status: 'error', reason: 'stalled', message: 'No data received for 30 seconds' }

/** A package port whose load state the test drives, recording the subscriptions it hands out. */
function createLoadStatePackages(initial: VppTargetLoadState, overrides: Partial<PackagePort> = {}) {
  let current = initial
  let boards: string[] = []
  const loadListeners = new Set<LoadListener>()
  const boardListeners = new Set<() => void>()
  const cancelTargetLoad = jest.fn()
  const retryTargetLoad = jest.fn(() => Promise.resolve())
  const port = stubPort<PackagePort>({
    listTargetBoards: () => Promise.resolve(boards),
    onBoardsUpdated: (callback) => {
      boardListeners.add(callback)
      return () => {
        boardListeners.delete(callback)
      }
    },
    getTargetLoadState: () => current,
    onTargetLoadStateChanged: (callback) => {
      loadListeners.add(callback)
      return () => {
        loadListeners.delete(callback)
      }
    },
    cancelTargetLoad,
    retryTargetLoad,
    ...overrides,
  })
  return {
    port,
    cancelTargetLoad,
    retryTargetLoad,
    push(next: VppTargetLoadState) {
      current = next
      act(() => {
        for (const listener of loadListeners) listener(next)
      })
    },
    publishBoards(next: string[]) {
      boards = next
      act(() => {
        for (const listener of boardListeners) listener()
      })
    },
    loadSubscriptions: () => loadListeners.size,
  }
}

function portsWith(packages: PackagePort | undefined): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort<RuntimePort>({
      getUsersInfo: () => Promise.resolve({ hasUsers: false, error: 'not connected' }),
      setDeviceContext: () => undefined,
      clearCredentials: () => Promise.resolve({ success: true }),
    }),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort<OrchestratorPort>({ listOrchestrators: () => Promise.resolve([]) }),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    packages,
    capabilities: WEB_CAPABILITIES,
  }
}

let store: OpenPLCStore

function renderList(packages: PackagePort | undefined) {
  return render(<OrchestratorsList />, { wrapper: createStoreWrapper(store, portsWith(packages)) })
}

/** The tokens of `expected` that `element` does not carry. */
function missingTokens(element: Element, expected: string): string[] {
  return expected.split(' ').filter((token) => !element.classList.contains(token))
}

/** Hovers `trigger` and lets the tooltip's open delay elapse. */
async function hoverUntilTooltip(trigger: HTMLElement): Promise<void> {
  jest.useFakeTimers()
  try {
    await userEvent.setup({ delay: null }).hover(trigger)
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_OPEN_MS)
    })
  } finally {
    jest.useRealTimers()
  }
}

/** The failure reason the retry button offers on hover: its `title`, or else its tooltip. */
async function reasonOfferedBy(retry: HTMLElement): Promise<string> {
  const title = retry.getAttribute('title')
  if (title) return title
  await hoverUntilTooltip(retry)
  return screen.getByRole('tooltip').textContent ?? ''
}

beforeEach(() => {
  store = createTestStore()
})

describe('while the package downloads', () => {
  it('shows the progress bar at the floored percentage of the bytes received', async () => {
    renderList(createLoadStatePackages(DOWNLOADING).port)

    const loading = await screen.findByTestId('vendor-package-loading')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('37')
    expect(loading.textContent).toContain('37%')
  })

  it('follows the progress the port reports', async () => {
    const packages = createLoadStatePackages(DOWNLOADING)
    renderList(packages.port)
    await screen.findByTestId('vendor-package-loading')

    packages.push({ status: 'downloading', loaded: 8_880_000, total: 11_100_000 })

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80')
    expect(screen.getByTestId('vendor-package-loading').textContent).toContain('80%')
  })

  it('shows the bytes received only in the tooltip of the bar', async () => {
    renderList(createLoadStatePackages(DOWNLOADING).port)
    const bar = await screen.findByRole('progressbar')
    expect(document.body.textContent).not.toContain('4.2 of 11.1 MB')

    await hoverUntilTooltip(bar)

    expect(screen.getByRole('tooltip').textContent).toContain('4.2 of 11.1 MB')
  })

  it('shows no step text', async () => {
    renderList(createLoadStatePackages(DOWNLOADING).port)

    const loading = await screen.findByTestId('vendor-package-loading')
    expect(loading.textContent).not.toMatch(/download|verif|fetch|load/i)
  })

  it('cancels the download from the close button', async () => {
    const packages = createLoadStatePackages(DOWNLOADING)
    renderList(packages.port)

    const cancel = await screen.findByRole('button', { name: 'Cancel download' })
    expect(cancel).toBe(screen.getByTestId('vendor-package-cancel'))
    await userEvent.click(cancel)

    expect(packages.cancelTargetLoad).toHaveBeenCalledTimes(1)
  })

  it('draws an indeterminate bar with no percentage when the host sent no total', async () => {
    renderList(createLoadStatePackages(NO_TOTAL).port)

    const loading = await screen.findByTestId('vendor-package-loading')
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
    expect(loading.textContent).not.toContain('%')
  })

  it('names the bytes received without a total in the tooltip', async () => {
    renderList(createLoadStatePackages(NO_TOTAL).port)

    await hoverUntilTooltip(await screen.findByRole('progressbar'))

    expect(screen.getByRole('tooltip').textContent).toContain('4.2 MB downloaded')
  })
})

describe('while the package is verified', () => {
  it('keeps the loading row with the bar at 100%', async () => {
    renderList(createLoadStatePackages(VERIFYING).port)

    await screen.findByTestId('vendor-package-loading')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('offers no cancel and shows no step text', async () => {
    renderList(createLoadStatePackages(VERIFYING).port)

    const loading = await screen.findByTestId('vendor-package-loading')
    expect(screen.queryByTestId('vendor-package-cancel')).toBeNull()
    expect(loading.textContent).not.toMatch(/verif/i)
  })
})

describe('when the load fails', () => {
  const reasons: ErrorReason[] = ['stalled', 'timeout', 'transfer', 'verification', 'canceled']

  it.each(reasons)('shows Download failed. and Try again for a %s failure', async (reason) => {
    renderList(createLoadStatePackages({ status: 'error', reason, message: `reason ${reason}` }).port)

    const error = await screen.findByTestId('vendor-package-error')
    expect(error.textContent).toContain('Download failed.')
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry).toBe(screen.getByTestId('vendor-package-retry'))
    expect(screen.queryByTestId('vendor-package-loading')).toBeNull()
  })

  it.each(reasons)('keeps the %s message off the screen and offers it on the retry button', async (reason) => {
    const message = `reason ${reason}`
    renderList(createLoadStatePackages({ status: 'error', reason, message }).port)

    const retry = await screen.findByTestId('vendor-package-retry')
    expect(document.body.textContent).not.toContain(message)
    expect(await reasonOfferedBy(retry)).toContain(message)
  })

  it('replaces the loading row when a download in progress fails', async () => {
    const packages = createLoadStatePackages(DOWNLOADING)
    renderList(packages.port)
    await screen.findByTestId('vendor-package-loading')

    packages.push(STALLED)

    expect(screen.getByTestId('vendor-package-error')).toBeTruthy()
    expect(screen.queryByTestId('vendor-package-loading')).toBeNull()
  })

  it('waits for the user after a verification failure instead of retrying on its own', async () => {
    const failure: VppTargetLoadState = { status: 'error', reason: 'verification', message: 'Signature mismatch' }
    const packages = createLoadStatePackages(failure)
    renderList(packages.port)
    await screen.findByTestId('vendor-package-error')

    packages.push(failure)

    expect(screen.getByTestId('vendor-package-error')).toBeTruthy()
    expect(packages.retryTargetLoad).not.toHaveBeenCalled()
  })
})

describe('Try again', () => {
  it('loads the package again once per click', async () => {
    const packages = createLoadStatePackages(STALLED)
    renderList(packages.port)

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(packages.retryTargetLoad).toHaveBeenCalledTimes(1)
  })

  it('is disabled while the retry runs and enabled again when it settles', async () => {
    let settle: () => void = () => undefined
    const retryTargetLoad = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    )
    renderList(createLoadStatePackages(STALLED, { retryTargetLoad }).port)
    const retry = await screen.findByRole('button', { name: 'Try again' })

    await userEvent.click(retry)
    await waitFor(() => expect(retry).toHaveProperty('disabled', true))
    await userEvent.click(retry)
    expect(retryTargetLoad).toHaveBeenCalledTimes(1)

    act(() => settle())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toHaveProperty('disabled', false))
  })

  it('handles a rejected retry and can be pressed again', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const retryTargetLoad = jest.fn(() => Promise.reject(new Error('network down')))
      renderList(createLoadStatePackages(STALLED, { retryTargetLoad }).port)

      await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toHaveProperty('disabled', false))
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(retryTargetLoad).toHaveBeenCalledTimes(2)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('the Vendor board card', () => {
  const CARD =
    'rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900'

  it.each([
    ['vendor-package-loading', DOWNLOADING],
    ['vendor-package-error', STALLED],
  ] as const)('holds %s under the Vendor board title', async (testId, state) => {
    renderList(createLoadStatePackages(state).port)

    const block = await screen.findByTestId(testId)
    const card = block.closest('.rounded-lg.border')
    expect(card).not.toBeNull()
    if (!card) return
    expect(missingTokens(card, CARD)).toEqual([])
    expect(card.textContent).toContain('Vendor board')
  })

  it('becomes the board dropdown when the load completes', async () => {
    const packages = createLoadStatePackages(DOWNLOADING)
    renderList(packages.port)
    await screen.findByTestId('vendor-package-loading')

    packages.push({ status: 'ready' })
    packages.publishBoards(['Board A', 'Board B'])

    expect(await screen.findByLabelText('Vendor board selection')).toBeTruthy()
    expect(screen.queryByTestId('vendor-package-loading')).toBeNull()
  })
})

describe('design tokens', () => {
  it('draws the bar with the track and fill of the ESI parse progress', async () => {
    renderList(createLoadStatePackages(DOWNLOADING).port)

    const loading = await screen.findByTestId('vendor-package-loading')
    const track = loading.querySelector('.h-2.overflow-hidden.rounded-full')
    expect(track).not.toBeNull()
    if (!track) return
    expect(missingTokens(track, 'h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700')).toEqual(
      [],
    )
    const fill = track.querySelector('.bg-brand')
    expect(fill).not.toBeNull()
    if (!fill) return
    expect(missingTokens(fill, 'h-full rounded-full bg-brand transition-all duration-200')).toEqual([])
  })

  it('sets the percentage in the muted extra-small text', async () => {
    renderList(createLoadStatePackages(DOWNLOADING).port)

    const percentage = await screen.findByText('37%')
    expect(missingTokens(percentage, 'text-xs text-neutral-600 dark:text-neutral-400')).toEqual([])
  })

  it('sets Download failed. in the small red text', async () => {
    renderList(createLoadStatePackages(STALLED).port)

    const text = await screen.findByText('Download failed.')
    const styled = text.closest('.text-red-600')
    expect(styled).not.toBeNull()
    if (!styled) return
    expect(missingTokens(styled, 'text-sm text-red-600 dark:text-red-400')).toEqual([])
  })

  it('styles Try again as the secondary button', async () => {
    renderList(createLoadStatePackages(STALLED).port)

    const retry = await screen.findByTestId('vendor-package-retry')
    expect(
      missingTokens(
        retry,
        'rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100',
      ),
    ).toEqual([])
  })
})

describe('when no package is loading', () => {
  it.each([
    ['vendor-package-loading', 'idle', DOWNLOADING],
    ['vendor-package-loading', 'ready', DOWNLOADING],
    ['vendor-package-error', 'ready', STALLED],
  ] as const)('clears %s when the state becomes %s', async (shownBlock, next, initial) => {
    const packages = createLoadStatePackages(initial)
    renderList(packages.port)
    await screen.findByTestId(shownBlock)

    packages.push({ status: next })

    expect(screen.queryByTestId('vendor-package-loading')).toBeNull()
    expect(screen.queryByTestId('vendor-package-error')).toBeNull()
  })

  it('renders no load block on a platform without a package port', async () => {
    renderList(undefined)

    await screen.findByText('No Edge Devices found.')
    expect(screen.queryByTestId('vendor-package-loading')).toBeNull()
    expect(screen.queryByTestId('vendor-package-error')).toBeNull()
  })
})

describe('the subscription', () => {
  it('is released on unmount', async () => {
    const packages = createLoadStatePackages(DOWNLOADING)
    const { unmount } = renderList(packages.port)
    await screen.findByTestId('vendor-package-loading')
    expect(packages.loadSubscriptions()).toBeGreaterThan(0)

    unmount()

    expect(packages.loadSubscriptions()).toBe(0)
  })
})
