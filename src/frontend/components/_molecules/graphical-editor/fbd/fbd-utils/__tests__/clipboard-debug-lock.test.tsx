import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { FBDRungState } from '@root/frontend/store/slices/fbd'
import { act, render } from '@testing-library/react'
import { useCallback, useRef } from 'react'

import type { OpenPLCStore } from '@root/frontend/store'

import { GraphicalEditorActiveProvider } from '../../../../../_features/[workspace]/editor/graphical/active-context'
import { useFBDClipboard } from '../useCopyPaste'

let store: OpenPLCStore

const POU_NAME = 'fbd-pou'

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
  const handleDeleteNodes = useCallback((nodes: { id: string }[]) => {
    deleted.push(nodes.length)
  }, [])

  useFBDClipboard({
    mousePositionRef,
    insideViewportRef,
    reactFlowInstance: null,
    rung,
    viewportRef,
    handleDeleteNodes,
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

const pastePayload = () =>
  new Map<string, string>([
    ['fbd:nodes', JSON.stringify({ language: 'fbd', content: { nodes: [node('pasted')], edges: [] } })],
  ])

const pastedNodeCount = () => store.getState().fbdFlows.find((flow) => flow.name === POU_NAME)?.rung.nodes.length ?? 0

const renderHarness = () => {
  store = createTestStore()
  deleted = []
  act(() => {
    store.getState().fbdFlowActions.addFBDFlow({ name: POU_NAME, updated: false, rung })
  })
  const { getByTestId } = render(
    <GraphicalEditorActiveProvider pouName={POU_NAME} isActive={true}>
      <Harness />
    </GraphicalEditorActiveProvider>,
    { wrapper: createStoreWrapper(store) },
  )
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

  it('should paste the clipboard nodes while no debug session is open', () => {
    const viewport = renderHarness()

    fireClipboard('paste', viewport, pastePayload())

    expect(pastedNodeCount()).toBe(3)
  })

  it('should paste nothing when the debug session opens after the editor mounted', () => {
    const viewport = renderHarness()
    openDebugSession()

    fireClipboard('paste', viewport, pastePayload())

    expect(pastedNodeCount()).toBe(2)
  })

  it('should paste again once the debug session is closed', () => {
    const viewport = renderHarness()
    openDebugSession()
    closeDebugSession()

    fireClipboard('paste', viewport, pastePayload())

    expect(pastedNodeCount()).toBe(3)
  })
})
