/**
 * `useAppUpdateStatus` (DOPE-486): the first read, later changes, and the race
 * between them. Always `none` without the port, as on the web.
 */
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { AppUpdatePort, AppUpdateStatus } from '../../../middleware/shared/ports/app-update-port'
import { EDITOR_CAPABILITIES } from '../../../middleware/shared/ports/platform-capabilities'
import { PlatformProvider } from '../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../middleware/shared/providers/types'
import { useAppUpdateStatus } from '../use-app-update-status'

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

function fakePort(read: Promise<AppUpdateStatus>) {
  let listener: ((status: AppUpdateStatus) => void) | null = null
  const port: AppUpdatePort = {
    getStatus: jest.fn(() => read),
    onStatusChanged: jest.fn((callback: (status: AppUpdateStatus) => void) => {
      listener = callback
      return () => {
        listener = null
      }
    }),
    downloadAndOpen: jest.fn(),
    dismiss: jest.fn(),
    checkNow: jest.fn(),
    isAutoCheckEnabled: jest.fn(() => Promise.resolve(true)),
    setAutoCheck: jest.fn(),
  }
  return {
    port,
    push: (status: AppUpdateStatus) => act(() => listener?.(status)),
    listening: () => listener !== null,
  }
}

function renderStatus(appUpdate?: AppUpdatePort) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports(appUpdate)}>{children}</PlatformProvider>
  )
  return renderHook(() => useAppUpdateStatus(), { wrapper })
}

describe('useAppUpdateStatus', () => {
  it('is none without the port (web)', () => {
    expect(renderStatus().result.current).toEqual({ state: 'none' })
  })

  it('reads the status on mount', async () => {
    const { port } = fakePort(Promise.resolve({ state: 'available', version: '4.3.3' }))
    const { result } = renderStatus(port)
    await act(() => Promise.resolve())
    expect(result.current).toEqual({ state: 'available', version: '4.3.3' })
  })

  it('follows later changes', async () => {
    const { port, push } = fakePort(Promise.resolve({ state: 'none' }))
    const { result } = renderStatus(port)
    await act(() => Promise.resolve())
    push({ state: 'downloading', version: '4.3.3', percent: 10 })
    expect(result.current).toEqual({ state: 'downloading', version: '4.3.3', percent: 10 })
  })

  it('a change pushed before the first read answers wins over that read', async () => {
    let resolveRead: (status: AppUpdateStatus) => void = () => undefined
    const read = new Promise<AppUpdateStatus>((resolve) => {
      resolveRead = resolve
    })
    const { port, push } = fakePort(read)
    const { result } = renderStatus(port)
    push({ state: 'available', version: '4.3.3' })
    resolveRead({ state: 'none' })
    await act(() => read)
    expect(result.current).toEqual({ state: 'available', version: '4.3.3' })
  })

  it('a failed first read leaves none', async () => {
    const { port } = fakePort(Promise.reject(new Error('no main')))
    const { result } = renderStatus(port)
    await act(() => Promise.resolve())
    expect(result.current).toEqual({ state: 'none' })
  })

  it('stops listening on unmount', async () => {
    const { port, listening } = fakePort(Promise.resolve({ state: 'none' }))
    const { unmount } = renderStatus(port)
    await act(() => Promise.resolve())
    expect(listening()).toBe(true)
    unmount()
    expect(listening()).toBe(false)
  })
})
