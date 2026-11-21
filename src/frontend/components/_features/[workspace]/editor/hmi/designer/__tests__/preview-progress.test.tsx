import { act, render, screen } from '@testing-library/react'

import { PreviewLoading } from '../parts'
import { PREVIEW_PROGRESS_DELAY_MS, previewProgress } from '../preview-progress'

const built = {}

describe('previewProgress', () => {
  it('shows a first build in place of the screen, and a build the screen waits for over the last frame', () => {
    expect(previewProgress({ status: 'building', step: 'compile', built: null, waiting: false })).toEqual({
      step: 'compile',
      dimmed: false,
    })
    expect(previewProgress({ status: 'building', step: null, built, waiting: true })).toEqual({
      step: 'sources',
      dimmed: true,
    })
  })

  it('shows nothing for a build the screen does not wait for, or when no build runs', () => {
    expect(previewProgress({ status: 'building', step: 'compile', built, waiting: false })).toBeNull()
    expect(previewProgress({ status: 'ready', step: null, built, waiting: true })).toBeNull()
    expect(previewProgress({ status: 'failed', step: null, built: null, waiting: false })).toBeNull()
  })
})

describe('PreviewLoading', () => {
  afterEach(() => jest.useRealTimers())

  it('stands in for the screen at once on its first build, with its step and an indeterminate bar', () => {
    render(<PreviewLoading step='generate' />)
    const loading = screen.getByTestId('hmi-preview-loading')
    expect(loading.dataset.dimmed).toBe('false')
    expect(loading.dataset.step).toBe('generate')
    expect(screen.getByText('Generating the screens')).toBeTruthy()
    const bar = screen.getByTestId('hmi-preview-loading-bar')
    expect(bar.className).toContain('animate-indeterminate-bar')
    expect(bar.getAttribute('style')).toBeNull()
  })

  it('dims the last frame only once an edit has waited, so builds that end quickly never flash it', () => {
    jest.useFakeTimers()
    const { rerender } = render(<PreviewLoading step='generate' dimmed />)
    expect(screen.queryByTestId('hmi-preview-loading')).toBeNull()
    act(() => jest.advanceTimersByTime(PREVIEW_PROGRESS_DELAY_MS - 1))
    expect(screen.queryByTestId('hmi-preview-loading')).toBeNull()
    act(() => jest.advanceTimersByTime(1))
    expect(screen.getByTestId('hmi-preview-loading').dataset.dimmed).toBe('true')
    rerender(<PreviewLoading step='start' dimmed />)
    expect(screen.getByTestId('hmi-preview-loading').dataset.step).toBe('start')
  })
})
