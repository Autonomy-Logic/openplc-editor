import type { BoardInfo } from '@root/middleware/shared/ports/types'

import { hiddenNativeScreens, isNativeScreenAvailable } from '../native-screens'

const board = (hidesNativeScreens?: string[]): BoardInfo =>
  ({
    vpp: hidesNativeScreens ? { hidesNativeScreens } : {},
  }) as unknown as BoardInfo

describe('hiddenNativeScreens', () => {
  it('reads the declaration off the board', () => {
    expect([...hiddenNativeScreens(board(['persistent-storage']))]).toEqual(['persistent-storage'])
  })

  it('is empty for a VPP that declares nothing', () => {
    expect(hiddenNativeScreens(board()).size).toBe(0)
  })

  it('is empty for a board that is not a VPP target', () => {
    expect(hiddenNativeScreens({} as BoardInfo).size).toBe(0)
  })

  it('is empty when the board has not resolved yet', () => {
    expect(hiddenNativeScreens(null).size).toBe(0)
    expect(hiddenNativeScreens(undefined).size).toBe(0)
  })
})

describe('isNativeScreenAvailable', () => {
  it('hides a screen the target replaces', () => {
    expect(isNativeScreenAvailable(board(['persistent-storage']), 'persistent-storage')).toBe(false)
  })

  it('shows a screen the target does not replace', () => {
    expect(isNativeScreenAvailable(board([]), 'persistent-storage')).toBe(true)
    expect(isNativeScreenAvailable(board(), 'persistent-storage')).toBe(true)
  })

  it('shows the native screen when there is no board info', () => {
    // The correct default: the runtime provides the feature unless a vendor has
    // taken it over. Failing closed here would hide working settings on every
    // plain runtime-v4 target while the board list is still loading.
    expect(isNativeScreenAvailable(null, 'persistent-storage')).toBe(true)
    expect(isNativeScreenAvailable(undefined, 'persistent-storage')).toBe(true)
  })
})
