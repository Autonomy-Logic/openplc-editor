import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { OpenPLCStore } from '../../../../store'
import { CreateEditorModelObject } from '../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { FBDToolbox } from '../fbd-toolbox'
import { LadderToolbox } from '../ladder-toolbox'

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

const dragSourceOf = (label: string): HTMLElement => {
  const source = screen.getByLabelText(label).querySelector<HTMLElement>('[draggable]')
  if (!source) throw new Error(`no drag source under "${label}"`)
  return source
}

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

const LADDER_SOURCES = ['Block', 'Coil', 'Contact']
const FBD_SOURCES = ['Block', 'Input variable', 'Out variable', 'Connector', 'Continuation', 'Comment']

const openLadderProgram = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'ld' }).ok).toBe(true)
  act(() => {
    store.getState().editorActions.setEditor(CreateEditorModelObject('main', 'ld', 'program'))
    store.getState().ladderFlowActions.startLadderRung({
      editorName: 'main',
      rungId: 'rung-1',
      defaultBounds: [1500, 200],
    })
  })
}

describe('graphical toolbox drag sources during a debug session (TC01)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should keep the ladder drag sources draggable while no debug session is open', () => {
    openLadderProgram()
    render(<LadderToolbox />)

    for (const label of LADDER_SOURCES) {
      expect(dragSourceOf(label).getAttribute('draggable')).toBe('true')
    }
  })

  it('should stop the ladder drag sources from being draggable while the debugger is open', () => {
    openLadderProgram()
    render(<LadderToolbox />)

    openDebugSession()

    for (const label of LADDER_SOURCES) {
      expect(dragSourceOf(label).getAttribute('draggable')).toBe('false')
    }
  })

  it('should give every locked ladder drag source the not-allowed cursor and the locked mark', () => {
    openLadderProgram()
    render(<LadderToolbox />)

    openDebugSession()

    for (const label of LADDER_SOURCES) {
      const source = dragSourceOf(label)
      expect(source.className).toContain('cursor-not-allowed')
      expect(source.getAttribute('data-editing-locked')).toBe('true')
      expect(source.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('should write no drag payload when a locked ladder drag source receives a drag start', () => {
    openLadderProgram()
    render(<LadderToolbox />)

    openDebugSession()

    for (const label of LADDER_SOURCES) {
      const { written, dataTransfer } = recordingDataTransfer()
      fireEvent.dragStart(dragSourceOf(label), { dataTransfer })
      expect(written).toHaveLength(0)
    }
  })

  it('should still write the drag payload when no debug session is open', () => {
    openLadderProgram()
    render(<LadderToolbox />)

    const { written, dataTransfer } = recordingDataTransfer()
    fireEvent.dragStart(dragSourceOf('Contact'), { dataTransfer })

    expect(written).toContainEqual(['application/reactflow/ladder-blocks', 'contact'])
  })

  it('should release the ladder drag sources once the debug session is closed', () => {
    openLadderProgram()
    render(<LadderToolbox />)

    openDebugSession()
    closeDebugSession()

    for (const label of LADDER_SOURCES) {
      expect(dragSourceOf(label).getAttribute('draggable')).toBe('true')
    }
  })

  it('should keep the FBD drag sources draggable while no debug session is open', () => {
    render(<FBDToolbox />)

    for (const label of FBD_SOURCES) {
      expect(dragSourceOf(label).getAttribute('draggable')).toBe('true')
    }
  })

  it('should stop the FBD drag sources from being draggable while the debugger is open', () => {
    render(<FBDToolbox />)

    openDebugSession()

    for (const label of FBD_SOURCES) {
      const source = dragSourceOf(label)
      expect(source.getAttribute('draggable')).toBe('false')
      expect(source.className).toContain('cursor-not-allowed')
    }
  })

  it('should write no drag payload when a locked FBD drag source receives a drag start', () => {
    render(<FBDToolbox />)

    openDebugSession()

    for (const label of FBD_SOURCES) {
      const { written, dataTransfer } = recordingDataTransfer()
      fireEvent.dragStart(dragSourceOf(label), { dataTransfer })
      expect(written).toHaveLength(0)
    }
  })
})

describe('delete selected elements during a debug session (TC02)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  const selectFirstNode = () => {
    const rung = store.getState().ladderFlows[0].rungs[0]
    act(() => {
      store.getState().ladderFlowActions.setSelectedNodes({
        editorName: 'main',
        rungId: 'rung-1',
        nodes: [rung.nodes[0]],
      })
    })
  }

  const deleteButton = () => screen.getByLabelText<HTMLButtonElement>('Delete element button')

  it('should keep the delete action available when elements are selected and no debugger is open', () => {
    openLadderProgram()
    render(<LadderToolbox />)
    selectFirstNode()

    expect(deleteButton().disabled).toBe(false)
  })

  it('should disable the delete action when the debugger starts after the selection was made', () => {
    openLadderProgram()
    render(<LadderToolbox />)
    selectFirstNode()

    openDebugSession()

    expect(deleteButton().disabled).toBe(true)
    expect(deleteButton().className).toContain('cursor-not-allowed')
  })

  it('should leave the rung untouched when the disabled delete action is clicked', () => {
    openLadderProgram()
    render(<LadderToolbox />)
    selectFirstNode()
    const before = store.getState().ladderFlows[0].rungs[0].nodes.length

    openDebugSession()
    fireEvent.click(deleteButton())

    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(before)
  })

  it('should release the delete action once the debug session is closed', () => {
    openLadderProgram()
    render(<LadderToolbox />)
    selectFirstNode()

    openDebugSession()
    closeDebugSession()

    expect(deleteButton().disabled).toBe(false)
  })
})
