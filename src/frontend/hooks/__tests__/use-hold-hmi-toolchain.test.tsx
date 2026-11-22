/**
 * @jest-environment jsdom
 */
import type { HmiPreviewPort } from '@root/middleware/shared/ports/hmi-preview-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import { act, renderHook } from '@testing-library/react'

import { createStoreWrapper, createTestPorts, createTestStore } from '../../store/testing'
import { isHmiTab, useHoldHmiToolchain } from '../use-hold-hmi-toolchain'

/** A preview port that records each hold change. */
function holdRecorder(): { port: HmiPreviewPort; holds: boolean[] } {
  const holds: boolean[] = []
  const unused = () => Promise.reject(new Error('not used'))
  const port: HmiPreviewPort = {
    build: unused,
    catalog: unused,
    thumbnails: unused,
    codeContext: unused,
    openSession: () => {
      throw new Error('not used')
    },
    holdToolchain: (held) => {
      holds.push(held)
      return Promise.resolve()
    },
  }
  return { port, holds }
}

describe('useHoldHmiToolchain', () => {
  it('holds the toolchain while an HMI tab is open, and lets it go when the last one closes', () => {
    const store = createTestStore()
    const { port, holds } = holdRecorder()
    const ports = createTestPorts({ capabilities: EDITOR_CAPABILITIES, hmiPreview: port })
    const { unmount } = renderHook(() => useHoldHmiToolchain(), { wrapper: createStoreWrapper(store, ports) })
    expect(holds).toEqual([])

    act(() => {
      store.getState().tabsActions.updateTabs({ name: 'main', elementType: { type: 'program', language: 'st' } })
    })
    expect(holds).toEqual([])
    act(() => {
      store.getState().tabsActions.updateTabs({ name: 'Overview', elementType: { type: 'hmi-screen' } })
    })
    act(() => {
      store.getState().tabsActions.updateTabs({ name: 'HMI Settings', elementType: { type: 'hmi-settings' } })
    })
    expect(holds).toEqual([true])

    act(() => {
      store.getState().tabsActions.setTabs(store.getState().tabs.filter((t) => t.name !== 'Overview'))
    })
    expect(holds).toEqual([true])
    act(() => {
      store.getState().tabsActions.setTabs(store.getState().tabs.filter((t) => !isHmiTab(t)))
    })
    expect(holds).toEqual([true, false])

    act(() => {
      store.getState().tabsActions.updateTabs({ name: 'Badge', elementType: { type: 'hmi-widget' } })
    })
    expect(holds).toEqual([true, false, true])
    act(() => unmount())
    expect(holds).toEqual([true, false, true, false])
  })
})
