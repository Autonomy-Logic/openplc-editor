/**
 * A placed library block must still resolve to its library after a project
 * opens.
 *
 * The graphical editors ring a block red when its instance variable does not
 * classify as `derived` against the block's own name — which is what happens
 * when the library pool is missing or blank at the moment project load
 * reclassifies the POU's variables. These drive the real open path and assert
 * that predicate directly.
 */

import { createStore } from 'zustand/vanilla'

import type { SystemLibrary } from '../../../middleware/shared/ports/library-types'
import { createAISlice } from '../slices/ai'
import { createConsoleSlice } from '../slices/console/slice'
import { createDeviceSlice } from '../slices/device/slice'
import { createEditorSlice } from '../slices/editor/slice'
import { createFBDFlowSlice } from '../slices/fbd/slice'
import { createFileSlice } from '../slices/file/slice'
import { createHistorySlice } from '../slices/history/slice'
import { createLadderFlowSlice } from '../slices/ladder/slice'
import { createLibrarySlice } from '../slices/library/slice'
import { createModalSlice } from '../slices/modal/slice'
import { createProjectSlice } from '../slices/project/slice'
import { createSearchSlice } from '../slices/search/slice'
import { createSharedSlice } from '../slices/shared/slice'
import type { SharedRootState } from '../slices/shared/types'
import { createTabsSlice } from '../slices/tabs/slice'
import { createVersionControlSlice } from '../slices/version-control/slice'
import { createWorkspaceSlice } from '../slices/workspace/slice'

function makeStore() {
  return createStore<SharedRootState>()((...args) => ({
    ...createProjectSlice(...args),
    ...createFileSlice(...args),
    ...createEditorSlice(...args),
    ...createTabsSlice(...args),
    ...createLibrarySlice(...args),
    ...createWorkspaceSlice(...args),
    ...createModalSlice(...args),
    ...createSearchSlice(...args),
    ...createConsoleSlice(...args),
    ...createDeviceSlice(...args),
    ...createFBDFlowSlice(...args),
    ...createLadderFlowSlice(...args),
    ...createHistorySlice(...args),
    ...createVersionControlSlice(...args),
    ...createAISlice(...args),
    ...createSharedSlice(...args),
  }))
}

const COUNTER_PINS = [
  { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
  { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'INT' } },
  { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'INT' } },
]

function library(version = '0.1.0', pins = COUNTER_PINS, documentation = 'v1 doc'): SystemLibrary {
  return {
    name: 'libtest-basic',
    author: '',
    version,
    stPath: '',
    cPath: '',
    pous: [{ name: 'COUNTER_FB', type: 'function-block', language: 'st', body: '', documentation, variables: pins }],
  } as unknown as SystemLibrary
}

/** A ladder POU with one placed COUNTER_FB, shaped as the editor saves it. */
function ladderProject(pinnedVersion: string) {
  const variant = {
    name: 'COUNTER_FB',
    type: 'function-block',
    documentation: 'stale doc',
    extensible: false,
    variables: [
      { name: 'EN', class: 'input', type: { definition: 'generic-type', value: 'BOOL' } },
      { name: 'ENO', class: 'output', type: { definition: 'generic-type', value: 'BOOL' } },
      ...COUNTER_PINS,
    ],
  }
  return {
    meta: { name: 'proj-ladder', type: 'plc-project' as const, path: '/bed/proj-ladder' },
    projectData: {
      dataTypes: [],
      globalVariableLists: [],
      libraries: [{ name: 'libtest-basic', version: pinnedVersion }],
      pous: [
        {
          name: 'main',
          pouType: 'program' as const,
          documentation: '',
          interface: {
            variables: [
              {
                name: 'COUNTER_FB0',
                class: 'local' as const,
                type: { definition: 'derived' as const, value: 'COUNTER_FB' },
                location: '',
                documentation: '',
              },
            ],
          },
          body: {
            language: 'ld' as const,
            value: {
              name: 'main',
              rungs: [
                {
                  id: 'rung-1',
                  comment: '',
                  defaultBounds: [300, 100],
                  reactFlowViewport: [900, 400],
                  selectedNodes: [],
                  edges: [],
                  nodes: [
                    {
                      // A variable wired to PV keeps its own copy of that pin's
                      // signature; the canvas renders it as `(*TYPE*)` and
                      // validates against it.
                      id: 'VARIABLE_1',
                      type: 'variable',
                      data: {
                        variant: 'input',
                        variable: { name: '' },
                        block: {
                          id: 'BLOCK_1',
                          handleId: 'PV',
                          variableType: { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'INT' } },
                        },
                      },
                    },
                    {
                      id: 'BLOCK_1',
                      type: 'block',
                      position: { x: 300, y: 30 },
                      data: {
                        variant,
                        variable: { id: 'v1', name: 'COUNTER_FB0' },
                        handles: [],
                        inputHandles: [],
                        outputHandles: [],
                        connectedVariables: [],
                      },
                    },
                  ],
                },
              ],
            } as unknown,
          },
        },
      ],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
  }
}

/** The predicate `ladder/block.tsx` uses to ring a block red. */
function ringsRed(store: ReturnType<typeof makeStore>): boolean {
  const pou = store.getState().project.data.pous.find((p) => p.name === 'main')
  const variable = pou?.interface?.variables.find((v) => v.name === 'COUNTER_FB0')
  if (!variable) return true
  return !(variable.type.definition === 'derived' && variable.type.value.toLowerCase() === 'counter_fb')
}

describe('a placed library block after project open', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  it('resolves against the library, so the block is not marked wrong', () => {
    store.getState().libraryActions.setSystemLibraries([library()])

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(ladderProject('0.1.0') as never)

    expect(store.getState().libraries.system.map((l) => l.name)).toEqual(['libtest-basic'])
    expect(ringsRed(store)).toBe(false)
  })

  it('still resolves when the project pins a version that is not installed', () => {
    store.getState().libraryActions.setSystemLibraries([library('0.1.0')])

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(ladderProject('9.9.9') as never)

    expect(store.getState().libraries.system).toHaveLength(1)
    expect(ringsRed(store)).toBe(false)
  })

  it('re-stamps the placed block from the library', () => {
    store.getState().libraryActions.setSystemLibraries([library()])

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(ladderProject('0.1.0') as never)

    const flow = store.getState().ladderFlows.find((f) => f.name === 'main')
    const node = flow?.rungs[0]?.nodes.find((n) => n.type === 'block')
    const variant = (node?.data as { variant: { documentation: string } }).variant
    expect(variant.documentation).toBe('v1 doc')
  })

  it('offers the newer version and switches to it without marking the block wrong', () => {
    const v2Pins = [
      { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'REAL' } },
      { name: 'RESET', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'INT' } },
    ]
    store.getState().libraryActions.setSystemLibraries([library('0.2.0', v2Pins, 'v2 doc'), library('0.1.0')])

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(ladderProject('0.1.0') as never)

    // Pinned to 0.1.0, with 0.2.0 available.
    expect(store.getState().libraries.system[0].version).toBe('0.1.0')
    expect(store.getState().outdatedLibraries).toEqual([
      { name: 'libtest-basic', pinned: '0.1.0', available: ['0.2.0', '0.1.0'] },
    ])
    expect(ringsRed(store)).toBe(false)

    store.getState().libraryActions.setLibraryVersion('libtest-basic', '0.2.0')

    expect(store.getState().libraries.system[0].version).toBe('0.2.0')
    expect(store.getState().outdatedLibraries).toEqual([])
    expect(ringsRed(store)).toBe(false)
  })

  it('writes the refresh into the project body, not just the canvas flow', () => {
    // Everything that persists or compiles reads `pou.body.value`; only the
    // canvas reads the flow. Refreshing one and not the other throws the work
    // away on save and re-reports it on the next open.
    const v2Pins = COUNTER_PINS.map((pin) =>
      pin.name === 'PV' ? { ...pin, type: { definition: 'base-type', value: 'REAL' } } : pin,
    )
    store.getState().libraryActions.setSystemLibraries([library('0.2.0', v2Pins, 'v2 doc')])

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(ladderProject('0.2.0') as never)

    const pinType = (variables: { name: string; type: { value: string } }[]) =>
      variables.find((v) => v.name === 'PV')?.type.value

    const flow = store.getState().ladderFlows.find((f) => f.name === 'main')
    const flowNode = flow?.rungs[0]?.nodes.find((n) => n.type === 'block')
    expect(pinType((flowNode?.data as { variant: { variables: never[] } }).variant.variables)).toBe('REAL')

    const body = store.getState().project.data.pous.find((p) => p.name === 'main')?.body.value as {
      rungs: { nodes: { type: string; data: { variant: { variables: never[]; documentation: string } } }[] }[]
    }
    const bodyNode = body.rungs[0].nodes.find((n) => n.type === 'block')!
    expect(pinType(bodyNode.data.variant.variables)).toBe('REAL')
    expect(bodyNode.data.variant.documentation).toBe('v2 doc')

    // The variable wired to PV must move with it, or the canvas keeps showing
    // `(*INT*)` and rejects a REAL variable dropped on the pin.
    const wired = body.rungs[0].nodes.find(
      (n) => (n.data as never as { block?: { handleId?: string } })?.block?.handleId === 'PV',
    )!
    expect(
      (wired.data as never as { block: { variableType: { type: { value: string } } } }).block.variableType.type.value,
    ).toBe('REAL')

    // And the project must be marked unsaved, or the refresh is never written
    // back and is redone on the next open.
    expect(store.getState().workspace.editingState).toBe('unsaved')
  })

  it('leaves a text POU alone: ST holds no signature to go stale', () => {
    // An ST body is a string. The block is reached through a declaration, and
    // the compiler resolves it against the pinned library, so there is nothing
    // cached that could disagree with the library -- and nothing to re-stamp.
    store.getState().libraryActions.setSystemLibraries([library()])

    const stProject = {
      meta: { name: 'proj-st', type: 'plc-project' as const, path: '/bed/proj-st' },
      projectData: {
        dataTypes: [],
        globalVariableLists: [],
        libraries: [{ name: 'libtest-basic', version: '0.1.0' }],
        pous: [
          {
            name: 'main',
            pouType: 'program' as const,
            documentation: '',
            interface: {
              variables: [
                {
                  name: 'COUNTER_FB0',
                  class: 'local' as const,
                  type: { definition: 'derived' as const, value: 'COUNTER_FB' },
                  location: '',
                  documentation: '',
                },
              ],
            },
            body: { language: 'st' as const, value: 'COUNTER_FB0(CU := TRUE);' as unknown },
          },
        ],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
    }

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(stProject as never)

    // Nothing re-stamped, nothing dirtied, and the instance still resolves.
    expect(store.getState().workspace.editingState).toBe('saved')
    expect(ringsRed(store)).toBe(false)
    expect(store.getState().project.data.pous[0].body.value).toBe('COUNTER_FB0(CU := TRUE);')
  })

  it('marks the block wrong when the library is genuinely absent', () => {
    // The control: with no pool, the variable cannot classify as `derived`.
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(ladderProject('0.1.0') as never)

    expect(ringsRed(store)).toBe(true)
  })
})
