import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { OpenPLCStore } from '../../../../../../store'
import type { RungLadderState } from '../../../../../../store/slices/ladder'
import { createStoreWrapper, createTestStore } from '../../../../../../store/testing'
import { GraphicalEditorActiveProvider } from '../../../../../_features/[workspace]/editor/graphical/active-context'
import { CreateRung } from '../create-rung'
import { RungHeader } from '../header'

let store: OpenPLCStore

const render = (ui: ReactElement) =>
  rtlRender(
    <GraphicalEditorActiveProvider pouName='main' isActive>
      {ui}
    </GraphicalEditorActiveProvider>,
    {
      wrapper: createStoreWrapper(store),
    },
  )

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const startRung = (): RungLadderState => {
  act(() => {
    store.getState().ladderFlowActions.startLadderRung({
      editorName: 'main',
      rungId: 'rung-1',
      defaultBounds: [1500, 200],
    })
    store.getState().ladderFlowActions.addComment({ editorName: 'main', rungId: 'rung-1', comment: 'Start pump' })
  })
  return store.getState().ladderFlows[0].rungs[0]
}

const renderHeader = () => {
  const rung = startRung()
  render(
    <RungHeader rung={rung} isOpen={false} draggableHandleProps={undefined} className='' onClick={() => undefined} />,
  )
}

const rungCount = () => store.getState().ladderFlows[0].rungs.length
const rungComment = () => store.getState().ladderFlows[0].rungs[0].comment
const duplicateButton = () => screen.getByLabelText<HTMLButtonElement>('Duplicate body button')
const deleteButton = () => screen.getByLabelText<HTMLButtonElement>('Delete body button')
const expandButton = () => screen.getByLabelText<HTMLButtonElement>('Expand body button')
const commentField = () =>
  screen.getByPlaceholderText<HTMLTextAreaElement>('Start typing to add a comment to this rung')

describe('rung header actions during a debug session (TC03)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should duplicate the rung when no debug session is open', () => {
    renderHeader()

    fireEvent.click(duplicateButton())

    expect(rungCount()).toBe(2)
  })

  it('should disable the duplicate action while the debugger is open', () => {
    renderHeader()

    openDebugSession()

    expect(duplicateButton().disabled).toBe(true)
    expect(duplicateButton().className).toContain('disabled:cursor-not-allowed')
  })

  it('should leave the rung count alone when the disabled duplicate action is clicked', () => {
    renderHeader()

    openDebugSession()
    fireEvent.click(duplicateButton())

    expect(rungCount()).toBe(1)
  })

  it('should open the delete confirmation when no debug session is open', () => {
    renderHeader()

    fireEvent.click(deleteButton())

    expect(store.getState().modals['confirm-delete-element'].open).toBe(true)
  })

  it('should disable the delete action while the debugger is open', () => {
    renderHeader()

    openDebugSession()

    expect(deleteButton().disabled).toBe(true)
  })

  it('should open no confirmation when the disabled delete action is clicked', () => {
    renderHeader()

    openDebugSession()
    fireEvent.click(deleteButton())

    expect(store.getState().modals['confirm-delete-element'].open).toBe(false)
  })

  it('should accept a new rung comment when no debug session is open', () => {
    renderHeader()

    fireEvent.change(commentField(), { target: { value: 'Start pump now' } })
    fireEvent.blur(commentField())

    expect(rungComment()).toBe('Start pump now')
  })

  it('should make the rung comment read only while the debugger is open', () => {
    renderHeader()

    openDebugSession()

    expect(commentField().readOnly).toBe(true)
  })

  it('should keep the rung comment unchanged when it is typed into while locked', () => {
    renderHeader()

    openDebugSession()
    fireEvent.change(commentField(), { target: { value: 'Start pump now' } })
    fireEvent.blur(commentField())

    expect(rungComment()).toBe('Start pump')
  })

  it('should keep expand and collapse available while the debugger is open (BR03)', () => {
    renderHeader()

    openDebugSession()

    expect(expandButton().disabled).toBe(false)
  })

  it('should release the rung header once the debug session is closed', () => {
    renderHeader()

    openDebugSession()
    closeDebugSession()

    expect(duplicateButton().disabled).toBe(false)
    expect(deleteButton().disabled).toBe(false)
    expect(commentField().readOnly).toBe(false)
  })
})

describe('create new rung during a debug session (TC04)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  const createButton = () => screen.getByLabelText<HTMLButtonElement>('Create new rung button')

  it('should call the create handler when no debug session is open', () => {
    const calls: number[] = []
    render(<CreateRung onClick={() => calls.push(1)} />)

    fireEvent.click(createButton())

    expect(calls).toHaveLength(1)
  })

  it('should disable the create action while the debugger is open', () => {
    render(<CreateRung onClick={() => undefined} />)

    openDebugSession()

    expect(createButton().disabled).toBe(true)
    expect(createButton().className).toContain('disabled:cursor-not-allowed')
  })

  it('should call no handler when the disabled create action is clicked', () => {
    const calls: number[] = []
    render(<CreateRung onClick={() => calls.push(1)} />)

    openDebugSession()
    fireEvent.click(createButton())

    expect(calls).toHaveLength(0)
  })

  it('should release the create action once the debug session is closed', () => {
    render(<CreateRung onClick={() => undefined} />)

    openDebugSession()
    closeDebugSession()

    expect(createButton().disabled).toBe(false)
  })
})
