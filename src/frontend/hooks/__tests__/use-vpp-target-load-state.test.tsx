import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { createTestPackagesPort } from '@root/frontend/store/testing-packages'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { VppTargetLoadState } from '@root/middleware/shared/ports/vpp-target-mechanisms'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, renderHook } from '@testing-library/react'

import { useVppTargetLoadState } from '../use-vpp-target-load-state'

/** The given ports with no `packages` port, as on a platform that wires none. */
function withoutPackages(ports: PlatformPorts): PlatformPorts {
  return new Proxy(ports, {
    get(target, prop, receiver) {
      if (prop === 'packages') return undefined
      const value: unknown = Reflect.get(target, prop, receiver)
      return value
    },
  })
}

const DOWNLOADING: VppTargetLoadState = { status: 'downloading', loaded: 4_200_000, total: 11_100_000 }
const STALLED: VppTargetLoadState = { status: 'error', reason: 'stalled', message: 'No data received for 30 seconds' }

let store: OpenPLCStore

function renderLoadState(ports: PlatformPorts) {
  return renderHook(() => useVppTargetLoadState(), { wrapper: createStoreWrapper(store, ports) })
}

beforeEach(() => {
  store = createTestStore()
})

describe('useVppTargetLoadState', () => {
  it('starts from the load state the packages port reports', () => {
    const packages = createTestPackagesPort(DOWNLOADING)

    const { result } = renderLoadState(createTestPorts({ capabilities: WEB_CAPABILITIES, packages: packages.port }))

    expect(result.current).toEqual(DOWNLOADING)
  })

  it('follows the changes the packages port reports', () => {
    const packages = createTestPackagesPort(DOWNLOADING)
    const { result } = renderLoadState(createTestPorts({ capabilities: WEB_CAPABILITIES, packages: packages.port }))

    act(() => packages.push(STALLED))
    expect(result.current).toEqual(STALLED)

    act(() => packages.push({ status: 'ready' }))
    expect(result.current).toEqual({ status: 'ready' })
  })

  it('stops listening on unmount', () => {
    const packages = createTestPackagesPort(DOWNLOADING)
    const { unmount } = renderLoadState(createTestPorts({ capabilities: WEB_CAPABILITIES, packages: packages.port }))
    expect(packages.subscriptions()).toBeGreaterThan(0)

    unmount()

    expect(packages.subscriptions()).toBe(0)
  })

  it('is idle on a platform without a packages port', () => {
    const { result } = renderLoadState(withoutPackages(createTestPorts({ capabilities: WEB_CAPABILITIES })))

    expect(result.current).toEqual({ status: 'idle' })
  })
})
