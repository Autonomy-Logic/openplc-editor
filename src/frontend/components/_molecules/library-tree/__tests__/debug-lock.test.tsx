import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { LibraryFile, LibraryRoot } from '../index'

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const recordingDataTransfer = () => {
  const written: Array<[string, string]> = []
  return {
    written,
    dataTransfer: {
      setData: (format: string, data: string) => written.push([format, data]),
      getData: () => '',
      setDragImage: () => undefined,
      effectAllowed: 'none',
      items: [],
      types: [],
    },
  }
}

const renderDraggableBlock = () =>
  render(
    <LibraryRoot>
      <LibraryFile
        label='TON'
        isSelected={false}
        onSelect={() => undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('application/reactflow/ladder-blocks', 'block')
          event.dataTransfer.setData('application/library', 'system/standard/TON')
        }}
      />
    </LibraryRoot>,
  )

const blockEntry = () => screen.getByText('TON').closest('li')

describe('library panel blocks during a debug session (TC01)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should keep a library block draggable while no debug session is open', () => {
    renderDraggableBlock()

    expect(blockEntry()?.getAttribute('draggable')).toBe('true')
  })

  it('should stop a library block from being draggable while the debugger is open', () => {
    renderDraggableBlock()

    openDebugSession()

    expect(blockEntry()?.getAttribute('draggable')).toBe('false')
  })

  it('should give a locked library block the not-allowed cursor and the locked mark', () => {
    renderDraggableBlock()

    openDebugSession()

    const entry = blockEntry()
    expect(entry?.className).toContain('cursor-not-allowed')
    expect(entry?.getAttribute('data-editing-locked')).toBe('true')
  })

  it('should write no drag payload when a locked library block receives a drag start', () => {
    renderDraggableBlock()

    openDebugSession()
    const { written, dataTransfer } = recordingDataTransfer()
    const entry = blockEntry()
    if (!entry) throw new Error('no library block entry')
    fireEvent.dragStart(entry, { dataTransfer })

    expect(written).toHaveLength(0)
  })

  it('should still write the drag payload when no debug session is open', () => {
    renderDraggableBlock()

    const { written, dataTransfer } = recordingDataTransfer()
    const entry = blockEntry()
    if (!entry) throw new Error('no library block entry')
    fireEvent.dragStart(entry, { dataTransfer })

    expect(written).toContainEqual(['application/library', 'system/standard/TON'])
  })

  it('should release a library block once the debug session is closed', () => {
    renderDraggableBlock()

    openDebugSession()
    closeDebugSession()

    expect(blockEntry()?.getAttribute('draggable')).toBe('true')
  })

  it('should leave a library entry that was never draggable untouched', () => {
    render(
      <LibraryRoot>
        <LibraryFile label='ADD' isSelected={false} onSelect={() => undefined} />
      </LibraryRoot>,
    )

    openDebugSession()

    const entry = screen.getByText('ADD').closest('li')
    expect(entry?.hasAttribute('draggable')).toBe(false)
    expect(entry?.className).not.toContain('cursor-not-allowed')
  })
})
