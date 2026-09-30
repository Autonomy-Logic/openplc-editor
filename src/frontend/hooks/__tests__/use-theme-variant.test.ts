import { act, renderHook } from '@testing-library/react'

const mockUnsubscribe = jest.fn()
const mockGetCurrentTheme = jest.fn()
const mockOnThemeChanged = jest.fn()
const mockThemePort = {
  getCurrentTheme: mockGetCurrentTheme,
  onThemeChanged: mockOnThemeChanged,
  setTheme: jest.fn(),
  toggleTheme: jest.fn(),
}

jest.mock('../../../middleware/shared/providers', () => ({
  useTheme: () => mockThemePort,
}))

import type { ThemeVariant } from '../../../middleware/shared/ports/theme-port'
import { useThemeVariant } from '../use-theme-variant'

let currentTheme: ThemeVariant
let notifyThemeChanged: (() => void) | undefined

beforeEach(() => {
  currentTheme = 'light'
  notifyThemeChanged = undefined
  mockUnsubscribe.mockReset()
  mockGetCurrentTheme.mockReset().mockImplementation(() => currentTheme)
  mockOnThemeChanged.mockReset().mockImplementation((callback: () => void) => {
    notifyThemeChanged = callback
    return mockUnsubscribe
  })
})

it('returns the current theme and updates when the port emits a change', () => {
  const { result } = renderHook(() => useThemeVariant())

  expect(result.current).toBe('light')

  act(() => {
    currentTheme = 'squareteal'
    notifyThemeChanged?.()
  })

  expect(result.current).toBe('squareteal')
})

it('unsubscribes when unmounted', () => {
  const { rerender, unmount } = renderHook(() => useThemeVariant())

  rerender()
  expect(mockOnThemeChanged).toHaveBeenCalledTimes(1)

  unmount()

  expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
})
