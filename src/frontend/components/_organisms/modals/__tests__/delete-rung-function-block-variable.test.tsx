import { act, fireEvent, render, screen } from '@testing-library/react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../store'
import type { RungLadderState } from '../../../../store/slices/ladder'
import { CreateEditorModelObject } from '../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { addNewElement } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { renderPlaceholderElements } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements/placeholder'
import { ConfirmDeleteElementModal } from '../delete-confirmation-modal'

const POU = 'main_ld'
const BLOCK_RUNG = 'rung-1'
const OTHER_RUNG = 'rung-2'

let store: OpenPLCStore

const instanceVariable = (name: string, variableClass: PLCVariable['class'] = 'local'): PLCVariable => ({
  name,
  class: variableClass,
  type: { definition: 'derived', value: 'TON' },
  location: '',
  documentation: '',
  debug: false,
})

const libraryVariant = (name: string) => {
  const pou = store
    .getState()
    .libraries.system.flatMap((library) => library.pous)
    .find((candidate) => candidate.name === name)
  if (!pou) throw new Error(`system library has no ${name}`)
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

const declare = (variable: PLCVariable) => {
  store.getState().projectActions.createVariable({ data: variable, scope: 'local', associatedPou: POU })
}

const placeOnNewRung = <T extends object>(
  rungId: string,
  element: { elementType: string; blockVariant?: T },
  variable: { name: string },
): void => {
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
}

const placeBlock = (rungId: string, instance: PLCVariable) =>
  placeOnNewRung(rungId, { elementType: 'block', blockVariant: libraryVariant('TON') }, instance)

const placeContact = (rungId: string, expression: string) =>
  placeOnNewRung(rungId, { elementType: 'contact' }, { name: expression })

const variableNames = (): string[] =>
  (store.getState().project.data.pous.find((pou) => pou.name === POU)?.interface?.variables ?? []).map(
    (variable) => variable.name,
  )

const deleteRung = (rungId: string) => {
  const rung = ladderRung(rungId)
  act(() => {
    store.getState().modalActions.openModal('confirm-delete-element', { name: rungId, elementType: 'rung' })
  })
  render(<ConfirmDeleteElementModal isOpen rung={rung} />, { wrapper: createStoreWrapper(store) })
  fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
}

describe('deleting a whole ladder rung from the confirmation modal', () => {
  beforeEach(() => {
    store = createTestStore()
    expect(store.getState().pouActions.create({ type: 'program', name: POU, language: 'ld' }).ok).toBe(true)
    act(() => {
      store.getState().editorActions.setEditor(CreateEditorModelObject(POU, 'ld', 'program'))
    })
  })

  it('removes the instance variable of a block nothing else uses', () => {
    const instance = instanceVariable('TON0')
    declare(instance)
    placeBlock(BLOCK_RUNG, instance)

    deleteRung(BLOCK_RUNG)

    expect(variableNames()).not.toContain('TON0')
  })

  it('keeps the instance variable when another rung reads it', () => {
    const instance = instanceVariable('TON0')
    declare(instance)
    placeBlock(BLOCK_RUNG, instance)
    placeContact(OTHER_RUNG, 'TON0.Q')

    deleteRung(BLOCK_RUNG)

    expect(variableNames()).toContain('TON0')
  })

  it('keeps an instance another rung still holds as a block', () => {
    const instance = instanceVariable('TON0')
    declare(instance)
    placeBlock(BLOCK_RUNG, instance)
    placeBlock(OTHER_RUNG, instance)

    deleteRung(BLOCK_RUNG)

    expect(variableNames()).toContain('TON0')
  })

  it('keeps a declaration the user wrote for another class', () => {
    const external = instanceVariable('ExtTimer', 'external')
    declare(external)
    placeBlock(BLOCK_RUNG, external)

    deleteRung(BLOCK_RUNG)

    expect(variableNames()).toContain('ExtTimer')
  })
})
