/**
 * The status bar's "Update" button (DOPE-486): shown only once a newer version
 * is out, and absent on a platform without the update port (web).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { AppUpdatePort, AppUpdateStatus } from '../../../../../middleware/shared/ports/app-update-port'
import { EDITOR_CAPABILITIES } from '../../../../../middleware/shared/ports/platform-capabilities'
import { PlatformProvider } from '../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../middleware/shared/providers/types'
import { StatusBar } from '..'

function stubPort<T extends object>(): T {
  return new Proxy(Object.create(null) as T, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
  })
}

function ports(appUpdate?: AppUpdatePort): PlatformPorts {
  return {
    compiler: stubPort(),
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
    appUpdate,
  }
}

function fakeUpdatePort(initial: AppUpdateStatus | Promise<AppUpdateStatus>) {
  let listener: ((status: AppUpdateStatus) => void) | null = null
  const port: AppUpdatePort = {
    getStatus: jest.fn(() => Promise.resolve(initial)),
    onStatusChanged: jest.fn((callback: (status: AppUpdateStatus) => void) => {
      listener = callback
      return () => {
        listener = null
      }
    }),
    downloadAndOpen: jest.fn(),
  }
  const push = (status: AppUpdateStatus) => act(() => listener?.(status))
  return { port, push, subscribed: () => listener !== null }
}

function renderBar(appUpdate: AppUpdatePort | undefined, children?: ReactNode) {
  return render(
    <PlatformProvider ports={ports(appUpdate)}>
      <StatusBar>{children}</StatusBar>
    </PlatformProvider>,
  )
}

const updateButton = () => screen.queryByRole('button', { name: /Update to/ })

describe('StatusBar', () => {
  it('renders nothing with no items and no update port (web)', () => {
    const { container } = renderBar(undefined)
    expect(container.innerHTML).toBe('')
  })

  it('shows its items without an Update button when there is no update', async () => {
    const { port } = fakeUpdatePort({ state: 'none' })
    renderBar(port, <span>main</span>)
    await act(() => Promise.resolve())
    expect(screen.getByText('main')).toBeTruthy()
    expect(updateButton()).toBeNull()
  })

  it('renders nothing with no items until a newer version is out', async () => {
    const { port } = fakeUpdatePort({ state: 'none' })
    const { container } = renderBar(port)
    await act(() => Promise.resolve())
    expect(container.innerHTML).toBe('')
  })

  it('shows the Update button for a version already known when it mounts', async () => {
    const { port } = fakeUpdatePort({ state: 'available', version: '4.3.3' })
    renderBar(port)
    expect(await screen.findByRole('button', { name: 'Update to 4.3.3' })).toBeTruthy()
  })

  it('shows it beside the items, on the right', async () => {
    const { port } = fakeUpdatePort({ state: 'available', version: '4.3.3' })
    renderBar(port, <span>main</span>)
    const button = await screen.findByRole('button', { name: 'Update to 4.3.3' })
    expect(screen.getByText('main').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows it when a newer version is found later, and hides it again', async () => {
    const { port, push } = fakeUpdatePort({ state: 'none' })
    renderBar(port)
    await act(() => Promise.resolve())

    push({ state: 'available', version: '4.3.3' })
    expect(updateButton()?.textContent).toBe('Update to 4.3.3')

    push({ state: 'none' })
    expect(updateButton()).toBeNull()
  })

  it('a change pushed before the first read answers wins over that read', async () => {
    let resolveRead: (status: AppUpdateStatus) => void = () => undefined
    const read = new Promise<AppUpdateStatus>((resolve) => {
      resolveRead = resolve
    })
    const { port, push } = fakeUpdatePort(read)
    renderBar(port)

    push({ state: 'available', version: '4.3.3' })
    resolveRead({ state: 'none' })
    await act(() => read)

    expect(updateButton()?.textContent).toBe('Update to 4.3.3')
  })

  it('clicking it downloads and opens the installer', async () => {
    const { port } = fakeUpdatePort({ state: 'available', version: '4.3.3' })
    renderBar(port)
    fireEvent.click(await screen.findByRole('button', { name: 'Update to 4.3.3' }))
    expect(port.downloadAndOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the progress while downloading, and cannot be clicked then', async () => {
    const { port, push } = fakeUpdatePort({ state: 'available', version: '4.3.3' })
    renderBar(port)
    await screen.findByRole('button', { name: 'Update to 4.3.3' })

    push({ state: 'downloading', version: '4.3.3', percent: 42 })
    const button = screen.getByRole('button', { name: 'Downloading 4.3.3… 42%' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(port.downloadAndOpen).not.toHaveBeenCalled()
  })

  it('once downloaded, offers to open the installer again', async () => {
    const { port } = fakeUpdatePort({ state: 'downloaded', version: '4.3.3' })
    renderBar(port)
    fireEvent.click(await screen.findByRole('button', { name: 'Install 4.3.3' }))
    expect(port.downloadAndOpen).toHaveBeenCalledTimes(1)
  })

  it('stops listening when it unmounts', async () => {
    const { port, subscribed } = fakeUpdatePort({ state: 'none' })
    const { unmount } = renderBar(port)
    await act(() => Promise.resolve())
    expect(subscribed()).toBe(true)
    unmount()
    expect(subscribed()).toBe(false)
  })

  it('a failed first read shows nothing and does not throw', async () => {
    const { port } = fakeUpdatePort({ state: 'none' })
    jest.mocked(port.getStatus).mockRejectedValue(new Error('no main'))
    const { container } = renderBar(port)
    await act(() => Promise.resolve())
    expect(container.innerHTML).toBe('')
  })
})
