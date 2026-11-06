import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { FBDRungState } from '@root/frontend/store/slices/fbd'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'

import type { OpenPLCStore } from '@root/frontend/store'

import { useFBDClipboard } from '../useCopyPaste'

let store: OpenPLCStore

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const node = (id: string) => ({
  id,
  type: 'block',
  position: { x: 0, y: 0 },
  data: {},
})

const rung: FBDRungState = {
  comment: '',
  nodes: [node('a'), node('b')],
  edges: [],
  selectedNodes: [node('a')],
}

let deleted: number[] = []

const Harness = () => {
  const viewportRef = useRef<HTMLDivElement>(null)
  const mousePositionRef = useRef({ x: 0, y: 0 })
  const insideViewportRef = useRef(true)

  useFBDClipboard({
    mousePositionRef,
    insideViewportRef,
    reactFlowInstance: null,
    rung,
    viewportRef,
    handleDeleteNodes: (nodes) => deleted.push(nodes.length),
  })

  return <div ref={viewportRef} data-testid='fbd-viewport' />
}

/** jsdom has no ClipboardEvent, so the test carries its own data transfer. */
const fireClipboard = (type: 'cut' | 'copy' | 'paste', target: EventTarget, stored: Map<string, string>) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (format: string, data: string) => stored.set(format, data),
      getData: (format: string) => stored.get(format) ?? '',
    },
  })
  Object.defineProperty(event, 'target', { value: target })
  act(() => {
    window.dispatchEvent(event)
  })
}

const renderHarness = () => {
  store = createTestStore()
  deleted = []
  const { getByTestId } = render(<Harness />, { wrapper: createStoreWrapper(store) })
  return getByTestId('fbd-viewport')
}

describe('FBD cut and paste during a debug session (TC17)', () => {
  it('should write the cut nodes to the clipboard while no debug session is open', () => {
    const viewport = renderHarness()
    const stored = new Map<string, string>()

    fireClipboard('cut', viewport, stored)

    expect(stored.has('fbd:nodes')).toBe(true)
  })

  it('should leave the clipboard untouched when cut arrives while the debugger is open', () => {
    const viewport = renderHarness()
    openDebugSession()
    const stored = new Map<string, string>([['fbd:nodes', 'copied-before']])

    fireClipboard('cut', viewport, stored)

    expect(stored.get('fbd:nodes')).toBe('copied-before')
  })

  it('should delete no node when cut arrives while the debugger is open', () => {
    const viewport = renderHarness()
    openDebugSession()

    fireClipboard('cut', viewport, new Map())

    expect(deleted).toEqual([])
  })

  it('should still copy while the debugger is open', () => {
    const viewport = renderHarness()
    openDebugSession()
    const stored = new Map<string, string>()

    fireClipboard('copy', viewport, stored)

    expect(stored.has('fbd:nodes')).toBe(true)
  })

  it('should cut again once the debug session is closed', () => {
    const viewport = renderHarness()
    openDebugSession()
    closeDebugSession()
    const stored = new Map<string, string>()

    fireClipboard('cut', viewport, stored)

    expect(stored.has('fbd:nodes')).toBe(true)
  })
})
