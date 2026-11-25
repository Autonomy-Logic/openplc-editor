import { act, render, renderHook } from '@testing-library/react'
import type { Node, NodeChange } from '@xyflow/react'

import type { PLCVariable } from '../../../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../../../store'
import { useOpenPLCStore } from '../../../../../../store'
import type { RungLadderState } from '../../../../../../store/slices/ladder'
import { CreateEditorModelObject } from '../../../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../../../store/testing'
import { GraphicalEditorActiveProvider } from '../../../../../_features/[workspace]/editor/graphical/active-context'
import { useProjectVariables } from '../../../../../_features/[workspace]/editor/server/opcua-server/hooks/use-project-variables'
import { RungBody } from '../body'
import { addNewElement } from '../ladder-utils/elements'
import { renderPlaceholderElements } from '../ladder-utils/elements/placeholder'

type CapturedViewport = {
  onNodesChange?: (changes: NodeChange[]) => void
  onNodesDelete?: (nodes: Node[]) => void
}

const mockReactFlow: { viewport: CapturedViewport } = { viewport: {} }

jest.mock('../../../../../_atoms/react-flow', () => ({
  ReactFlowPanel: ({ viewportConfig }: { viewportConfig: CapturedViewport }) => {
    mockReactFlow.viewport = viewportConfig
    return null
  },
}))

const POU = 'main_ld'
const BLOCK_RUNG = 'rung-1'
const CONTACT_RUNG = 'rung-2'

let store: OpenPLCStore

const instanceVariable = (name: string, functionBlock: string, id?: string): PLCVariable => ({
  ...(id ? { id } : {}),
  name,
  class: 'local',
  type: { definition: 'derived', value: functionBlock },
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

const userFunctionBlockVariant = (name: string) => ({
  name,
  type: 'function-block',
  variables: [
    { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: '',
  extensible: false,
})

const ladderRung = (rungId: string): RungLadderState => {
  const rung = store
    .getState()
    .ladderFlows.find((flow) => flow.name === POU)
    ?.rungs.find((candidate) => candidate.id === rungId)
  if (!rung) throw new Error(`no rung ${rungId} in ${POU}`)
  return rung
}

const nodeOn = (rungId: string, nodeId: string): Node => {
  const node = ladderRung(rungId).nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`no node ${nodeId} on ${rungId}`)
  return node
}

const variableNames = (): string[] =>
  (store.getState().project.data.pous.find((pou) => pou.name === POU)?.interface?.variables ?? []).map(
    (variable) => variable.name,
  )

const opcuaVariableNames = (): string[] => {
  const { result } = renderHook(() => useProjectVariables(), { wrapper: createStoreWrapper(store) })
  return (result.current.find((node) => node.name === POU)?.children ?? []).map((child) => child.name)
}

const declare = (variable: PLCVariable) => {
  store.getState().projectActions.createVariable({ data: variable, scope: 'local', associatedPou: POU })
}

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

const placeBlock = <T extends object>(variant: T, instance: PLCVariable): string =>
  placeOnNewRung(BLOCK_RUNG, { elementType: 'block', blockVariant: variant }, instance)

const RungHost = () => {
  const rung = useOpenPLCStore((state) =>
    state.ladderFlows.find((flow) => flow.name === POU)?.rungs.find((candidate) => candidate.id === BLOCK_RUNG),
  )
  return rung ? <RungBody rung={rung} /> : null
}

const renderRung = () =>
  render(
    <GraphicalEditorActiveProvider pouName={POU} isActive>
      <RungHost />
    </GraphicalEditorActiveProvider>,
    { wrapper: createStoreWrapper(store) },
  )

const deleteBlock = (blockId: string) => {
  const block = nodeOn(BLOCK_RUNG, blockId)
  act(() => {
    mockReactFlow.viewport.onNodesDelete?.([block])
    mockReactFlow.viewport.onNodesChange?.([{ type: 'remove', id: blockId }])
  })
}

describe('Ladder rung: deleting a function block removes its unreferenced instance variable', () => {
  beforeEach(() => {
    mockReactFlow.viewport = {}
    store = createTestStore()
    expect(store.getState().pouActions.create({ type: 'program', name: POU, language: 'ld' }).ok).toBe(true)
  })

  it('removes the TON instance from the POU variables when its block is deleted', () => {
    const instance = instanceVariable('TON1', 'TON', 'variable-id-ton1')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    renderRung()

    deleteBlock(blockId)

    expect(variableNames()).not.toContain('TON1')
  })

  it('stops offering the deleted instance in the OPC-UA Available PLC Variables of the POU', () => {
    const instance = instanceVariable('TON1', 'TON', 'variable-id-ton1')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    renderRung()
    expect(opcuaVariableNames()).toContain('TON1')

    deleteBlock(blockId)

    expect(opcuaVariableNames()).not.toContain('TON1')
  })

  it('removes an instance declared without an id, as in a reopened project', () => {
    const instance = instanceVariable('TON1', 'TON')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    renderRung()

    deleteBlock(blockId)

    expect(variableNames()).not.toContain('TON1')
  })

  it('removes the instance of a user-defined function block', () => {
    expect(store.getState().pouActions.create({ type: 'function-block', name: 'MyFB', language: 'st' }).ok).toBe(true)
    const instance = instanceVariable('MyFB0', 'MyFB', 'variable-id-myfb0')
    declare(instance)
    const blockId = placeBlock(userFunctionBlockVariant('MyFB'), instance)
    renderRung()

    deleteBlock(blockId)

    expect(variableNames()).not.toContain('MyFB0')
  })

  it('leaves alone another variable whose name equals the instance id', () => {
    const instance = instanceVariable('TON1', 'TON', 'Count')
    declare(instance)
    declare({
      name: 'Count',
      class: 'local',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
    })
    const blockId = placeBlock(libraryVariant('TON'), instance)
    renderRung()

    deleteBlock(blockId)

    expect(variableNames()).toContain('Count')
  })

  it('keeps the instance when a contact in another rung reads its output', () => {
    const instance = instanceVariable('TON1', 'TON', 'variable-id-ton1')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    placeOnNewRung(CONTACT_RUNG, { elementType: 'contact' }, { name: 'TON1.Q' })
    renderRung()

    deleteBlock(blockId)

    expect(variableNames()).toContain('TON1')
  })

  it('leaves the binding of the contact in another rung unchanged', () => {
    const instance = instanceVariable('TON1', 'TON', 'variable-id-ton1')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    const contactId = placeOnNewRung(CONTACT_RUNG, { elementType: 'contact' }, { name: 'TON1.Q' })
    const bindingBefore = nodeOn(CONTACT_RUNG, contactId).data.variable
    renderRung()

    deleteBlock(blockId)

    expect(nodeOn(CONTACT_RUNG, contactId).data.variable).toEqual(bindingBefore)
  })

  it('clears the variables table selection when the deleted instance was the selected row', () => {
    const instance = instanceVariable('TON1', 'TON', 'variable-id-ton1')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    act(() => {
      store.getState().editorActions.setEditor(CreateEditorModelObject(POU, 'ld', 'program'))
      store.getState().editorActions.updateModelVariables({ display: 'table', selectedRow: 0 })
    })
    renderRung()

    deleteBlock(blockId)

    const { editor } = store.getState()
    expect(editor.type === 'plc-graphical' && editor.variable.display === 'table' && editor.variable.selectedRow).toBe(
      '-1',
    )
  })

  it('restores both the block and its instance with a single undo', () => {
    const instance = instanceVariable('TON1', 'TON', 'variable-id-ton1')
    declare(instance)
    const blockId = placeBlock(libraryVariant('TON'), instance)
    renderRung()
    deleteBlock(blockId)
    expect(variableNames()).not.toContain('TON1')

    act(() => {
      store.getState().snapshotActions.undo(POU)
    })

    expect({
      block: ladderRung(BLOCK_RUNG).nodes.some((node) => node.id === blockId),
      variables: variableNames(),
    }).toEqual({ block: true, variables: ['TON1'] })
  })
})
