import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, render } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { DEBUG_SESSION_FRAME_COLOR, DebugSessionFrame } from '../index'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../../_organisms/panel'

let store: OpenPLCStore
let container: HTMLElement

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const frame = () => container.querySelector('[data-debug-session-frame="true"]')

/** jsdom serialises an inline hex colour as rgb(), so the expectation is built the same way. */
const asRgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

const renderFrame = () => {
  store = createTestStore()
  container = render(<DebugSessionFrame />, { wrapper: createStoreWrapper(store) }).container
}

describe('the online frame (TC24, TC25)', () => {
  it('should show no frame while no debug session is open', () => {
    renderFrame()

    expect(frame()).toBeNull()
  })

  it('should show the frame once the debugger starts', () => {
    renderFrame()

    openDebugSession()

    expect(frame()).not.toBeNull()
  })

  it('should paint the frame in the bright green of the online mode', () => {
    renderFrame()

    openDebugSession()

    expect(frame()?.getAttribute('style')).toContain(asRgb(DEBUG_SESSION_FRAME_COLOR))
  })

  it('should lay the frame along the outer edge of the window', () => {
    renderFrame()

    openDebugSession()

    const className = frame()?.className ?? ''
    expect(className).toContain('fixed')
    expect(className).toContain('inset-0')
  })

  it('should let every click through the frame', () => {
    renderFrame()

    openDebugSession()

    expect(frame()?.className).toContain('pointer-events-none')
  })

  it('should hide the frame again once the debugger closes', () => {
    renderFrame()

    openDebugSession()
    closeDebugSession()

    expect(frame()).toBeNull()
  })
})

describe('the gaps between the panels (TC24)', () => {
  const renderPanels = () => {
    store = createTestStore()
    container = render(
      <ResizablePanelGroup direction='horizontal'>
        <ResizablePanel>left</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>right</ResizablePanel>
      </ResizablePanelGroup>,
      { wrapper: createStoreWrapper(store) },
    ).container
  }

  const handle = () => container.querySelector('[data-panel-resize-handle-id]')

  it('should leave the gap unmarked while no debug session is open', () => {
    renderPanels()

    expect(handle()?.getAttribute('data-editing-locked')).toBeNull()
  })

  it('should mark the gap while the debugger is open', () => {
    renderPanels()

    openDebugSession()

    expect(handle()?.getAttribute('data-editing-locked')).toBe('true')
  })

  it('should paint the gap in the same green as the frame', () => {
    renderPanels()

    openDebugSession()

    expect(handle()?.getAttribute('style')).toContain(asRgb(DEBUG_SESSION_FRAME_COLOR))
  })

  it('should unmark the gap once the debugger closes', () => {
    renderPanels()

    openDebugSession()
    closeDebugSession()

    expect(handle()?.getAttribute('data-editing-locked')).toBeNull()
  })
})
