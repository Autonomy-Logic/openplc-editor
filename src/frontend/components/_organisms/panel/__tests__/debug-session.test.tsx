import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, render } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../index'

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

const handle = () => container.querySelector<HTMLElement>('[data-panel-resize-handle-id]')

describe('the gaps between the panels during a debug session', () => {
  it('should leave the gap unmarked while no debug session is open', () => {
    renderPanels()

    expect(handle()?.getAttribute('data-editing-locked')).toBeNull()
  })

  it('should mark the gap while the debugger is open', () => {
    renderPanels()

    openDebugSession()

    expect(handle()?.getAttribute('data-editing-locked')).toBe('true')
  })

  it('should keep the normal gap colour while the debugger is open', () => {
    renderPanels()

    openDebugSession()

    expect(handle()?.style.backgroundColor).toBe('')
  })

  it('should unmark the gap once the debugger closes', () => {
    renderPanels()

    openDebugSession()
    closeDebugSession()

    expect(handle()?.getAttribute('data-editing-locked')).toBeNull()
  })
})
