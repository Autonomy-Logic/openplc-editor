import { act, fireEvent, render, screen } from '@testing-library/react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../store'
import type { RungLadderState } from '../../../../store/slices/ladder'
import { CreateEditorModelObject } from '../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { addNewElement } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { renderPlaceholderElements } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements/placeholder'
import { LadderToolbox } from '../ladder-toolbox'

const POU = 'main'
const BLOCK_RUNG = 'rung-1'
const CONTACT_RUNG = 'rung-2'

let store: OpenPLCStore

const tonInstance = (name: string): PLCVariable => ({
  id: `variable-id-${name}`,
  name,
  class: 'local',
  type: { definition: 'derived', value: 'TON' },
  location: '',
  documentation: '',
  debug: false,
})

const tonVariant = () => {
  const pou = store
    .getState()
    .libraries.system.flatMap((library) => library.pous)
    .find((candidate) => candidate.name === 'TON')
  if (!pou) throw new Error('system library has no TON')
  return {
    name: pou.name,
    type: pou.type,
    variables: pou.variables,
    documentation: pou.documentation,
    extensible: false,
  }
}

const ladderRung = (rungId: string): RungLadderState => {
  const rung = store
    .getState()
    .ladderFlows.find((flow) => flow.name === POU)
    ?.rungs.find((candidate) => candidate.id === rungId)
  if (!rung) throw new Error(`no rung ${rungId} in ${POU}`)
  return rung
}

const variableNames = (): string[] =>
  (store.getState().project.data.pous.find((pou) => pou.name === POU)?.interface?.variables ?? []).map(
    (variable) => variable.name,
  )

const placeOnNewRung = <T extends object>(
  rungId: string,
  element: { elementType: string; blockVariant?: T },
  variable: { name: string },
): string => {
  const actions = store.getState().ladderFlowActions
  actions.startLadderRung({ editorName: POU, rungId, defaultBounds: [1500, 200] })
  const rung = ladderRung(rungId)
  const withPlaceholders = renderPlaceholderElements(rung)
  const placeholder = withPlaceholders.find((node) => node.type === 'placeholder')
  if (!placeholder) throw new Error(`no placeholder on ${rungId}`)
  const { nodes, edges, newNode } = addNewElement(
    { ...rung, nodes: withPlaceholders.map((node) => ({ ...node, selected: node.id === placeholder.id })) },
    element,
  )
  if (!newNode) throw new Error(`no ${element.elementType} placed on ${rungId}`)
  actions.setNodes({
    editorName: POU,
    rungId,
    nodes: nodes.map((node) => (node.id === newNode.id ? { ...node, data: { ...node.data, variable } } : node)),
  })
  actions.setEdges({ editorName: POU, rungId, edges })
  return newNode.id
}

const openProgramWithTon = (instance: PLCVariable): string => {
  expect(store.getState().pouActions.create({ type: 'program', name: POU, language: 'ld' }).ok).toBe(true)
  store.getState().projectActions.createVariable({ data: instance, scope: 'local', associatedPou: POU })
  const blockId = placeOnNewRung(BLOCK_RUNG, { elementType: 'block', blockVariant: tonVariant() }, instance)
  act(() => {
    store.getState().editorActions.setEditor(CreateEditorModelObject(POU, 'ld', 'program'))
  })
  return blockId
}

const openProgramWithSelectedTon = (instance: PLCVariable): string => {
  const blockId = openProgramWithTon(instance)
  act(() => {
    store.getState().ladderFlowActions.setSelectedNodes({
      editorName: POU,
      rungId: BLOCK_RUNG,
      nodes: ladderRung(BLOCK_RUNG).nodes.filter((node) => node.id === blockId),
    })
  })
  return blockId
}

const undoDepth = (): number => store.getState().undoRedo[POU]?.past.length ?? 0

const clickDeleteSelectedElements = () => {
  fireEvent.click(screen.getByLabelText('Delete element button'))
}

describe('Ladder toolbox: "Delete selected elements" removes the unreferenced instance variable', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('removes the TON instance from the POU variables when its selected block is deleted', () => {
    openProgramWithSelectedTon(tonInstance('TON1'))
    render(<LadderToolbox />, { wrapper: createStoreWrapper(store) })

    clickDeleteSelectedElements()

    expect(variableNames()).not.toContain('TON1')
  })

  it('keeps the instance when a contact in another rung reads its output', () => {
    openProgramWithSelectedTon(tonInstance('TON1'))
    placeOnNewRung(CONTACT_RUNG, { elementType: 'contact' }, { name: 'TON1.Q' })
    render(<LadderToolbox />, { wrapper: createStoreWrapper(store) })

    clickDeleteSelectedElements()

    expect(variableNames()).toContain('TON1')
  })
})

describe('Ladder toolbox: "Delete selected elements" is one undo step', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('restores both the block and its instance with a single undo', () => {
    const blockId = openProgramWithSelectedTon(tonInstance('TON1'))
    render(<LadderToolbox />, { wrapper: createStoreWrapper(store) })
    clickDeleteSelectedElements()
    expect(variableNames()).not.toContain('TON1')

    act(() => {
      store.getState().snapshotActions.undo(POU)
    })

    expect({
      block: ladderRung(BLOCK_RUNG).nodes.some((node) => node.id === blockId),
      variables: variableNames(),
    }).toEqual({ block: true, variables: ['TON1'] })
  })

  it('leaves the undo history unchanged when nothing is selected', () => {
    openProgramWithTon(tonInstance('TON1'))
    const depthBefore = undoDepth()
    render(<LadderToolbox />, { wrapper: createStoreWrapper(store) })

    clickDeleteSelectedElements()

    expect(undoDepth()).toBe(depthBefore)
  })
})
