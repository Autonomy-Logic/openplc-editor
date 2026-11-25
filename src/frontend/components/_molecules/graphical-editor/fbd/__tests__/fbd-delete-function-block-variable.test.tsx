import { act, render, renderHook } from '@testing-library/react'
import type { Edge, Node, NodeChange } from '@xyflow/react'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../../../store'
import { useOpenPLCStore } from '../../../../../store'
import { CreateEditorModelObject } from '../../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../../store/testing'
import { nodesBuilder } from '../../../../_atoms/graphical-editor/fbd'
import { GraphicalEditorActiveProvider } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { useProjectVariables } from '../../../../_features/[workspace]/editor/server/opcua-server/hooks/use-project-variables'
import { FBDBody } from '..'

type CapturedViewport = {
  onNodesChange?: (changes: NodeChange[]) => void
  onDelete?: (params: { nodes: Node[]; edges: Edge[] }) => void
}

const mockReactFlow: { viewport: CapturedViewport } = { viewport: {} }

jest.mock('../../../../_atoms/react-flow', () => ({
  ReactFlowPanel: ({ viewportConfig }: { viewportConfig: CapturedViewport }) => {
    mockReactFlow.viewport = viewportConfig
    return null
  },
}))

const POU = 'main_fbd'

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

const fbdNodes = (): Node[] => {
  const flow = store.getState().fbdFlows.find((candidate) => candidate.name === POU)
  if (!flow) throw new Error(`no FBD flow for ${POU}`)
  return flow.rung.nodes
}

const variableNames = (): string[] =>
  (store.getState().project.data.pous.find((pou) => pou.name === POU)?.interface?.variables ?? []).map(
    (variable) => variable.name,
  )

const opcuaVariableNames = (): string[] => {
  const { result } = renderHook(() => useProjectVariables(), { wrapper: createStoreWrapper(store) })
  return (result.current.find((node) => node.name === POU)?.children ?? []).map((child) => child.name)
}

const createProgram = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: POU, language: 'fbd' }).ok).toBe(true)
}

const declare = (variable: PLCVariable) => {
  store.getState().projectActions.createVariable({ data: variable, scope: 'local', associatedPou: POU })
}

const placeBlock = <T extends object>(blockId: string, variant: T, instance: PLCVariable, x: number) => {
  const node = nodesBuilder.block({ id: blockId, position: { x, y: 100 }, variant })
  store.getState().fbdFlowActions.addNode({
    editorName: POU,
    node: { ...node, data: { ...node.data, variable: instance } },
  })
}

const FbdHost = () => {
  const rung = useOpenPLCStore((state) => state.fbdFlows.find((flow) => flow.name === POU)?.rung)
  return rung ? <FBDBody rung={rung} /> : null
}

const renderDiagram = () =>
  render(
    <GraphicalEditorActiveProvider pouName={POU} isActive>
      <FbdHost />
    </GraphicalEditorActiveProvider>,
    { wrapper: createStoreWrapper(store) },
  )

const deleteBlock = (blockId: string) => {
  const block = fbdNodes().find((node) => node.id === blockId)
  if (!block) throw new Error(`no block ${blockId} in the diagram`)
  act(() => {
    mockReactFlow.viewport.onNodesChange?.([{ type: 'remove', id: blockId }])
    mockReactFlow.viewport.onDelete?.({ nodes: [block], edges: [] })
  })
}

describe('FBD: deleting a function block removes its unreferenced instance variable', () => {
  beforeEach(() => {
    mockReactFlow.viewport = {}
    store = createTestStore()
    createProgram()
  })

  it('removes the TON instance from the POU variables when its block is deleted', () => {
    const instance = instanceVariable('TON0', 'TON', 'variable-id-ton0')
    declare(instance)
    placeBlock('block-ton0', libraryVariant('TON'), instance, 200)
    renderDiagram()

    deleteBlock('block-ton0')

    expect(variableNames()).not.toContain('TON0')
  })

  it('stops offering the deleted instance in the OPC-UA Available PLC Variables of the POU', () => {
    const instance = instanceVariable('TON0', 'TON', 'variable-id-ton0')
    declare(instance)
    placeBlock('block-ton0', libraryVariant('TON'), instance, 200)
    renderDiagram()
    expect(opcuaVariableNames()).toContain('TON0')

    deleteBlock('block-ton0')

    expect(opcuaVariableNames()).not.toContain('TON0')
  })

  it('removes an instance declared without an id, as in a reopened project', () => {
    const instance = instanceVariable('TON0', 'TON')
    declare(instance)
    placeBlock('block-ton0', libraryVariant('TON'), instance, 200)
    renderDiagram()

    deleteBlock('block-ton0')

    expect(variableNames()).not.toContain('TON0')
  })

  it('removes the instance of a user-defined function block', () => {
    expect(store.getState().pouActions.create({ type: 'function-block', name: 'MyFB', language: 'st' }).ok).toBe(true)
    const instance = instanceVariable('MyFB0', 'MyFB', 'variable-id-myfb0')
    declare(instance)
    placeBlock('block-myfb0', userFunctionBlockVariant('MyFB'), instance, 200)
    renderDiagram()

    deleteBlock('block-myfb0')

    expect(variableNames()).not.toContain('MyFB0')
  })

  it('keeps the instance when another block in the diagram still uses it', () => {
    const instance = instanceVariable('TON0', 'TON', 'variable-id-ton0')
    declare(instance)
    placeBlock('block-ton0-a', libraryVariant('TON'), instance, 200)
    placeBlock('block-ton0-b', libraryVariant('TON'), instance, 500)
    renderDiagram()

    deleteBlock('block-ton0-a')

    expect(variableNames()).toContain('TON0')
  })

  it('clears the variables table selection when the deleted instance was the selected row', () => {
    const instance = instanceVariable('TON0', 'TON', 'variable-id-ton0')
    declare(instance)
    placeBlock('block-ton0', libraryVariant('TON'), instance, 200)
    act(() => {
      store.getState().editorActions.setEditor(CreateEditorModelObject(POU, 'fbd', 'program'))
      store.getState().editorActions.updateModelVariables({ display: 'table', selectedRow: 0 })
    })
    renderDiagram()

    deleteBlock('block-ton0')

    const { editor } = store.getState()
    expect(editor.type === 'plc-graphical' && editor.variable.display === 'table' && editor.variable.selectedRow).toBe(
      '-1',
    )
  })

  it('restores both the block and its instance with a single undo', () => {
    const instance = instanceVariable('TON0', 'TON', 'variable-id-ton0')
    declare(instance)
    placeBlock('block-ton0', libraryVariant('TON'), instance, 200)
    renderDiagram()
    deleteBlock('block-ton0')
    expect(variableNames()).not.toContain('TON0')

    act(() => {
      store.getState().snapshotActions.undo(POU)
    })

    expect({
      block: fbdNodes().some((node) => node.id === 'block-ton0'),
      variables: variableNames(),
    }).toEqual({ block: true, variables: ['TON0'] })
  })
})
