import { beforeEach, describe, expect, it } from '@jest/globals'

import type { PLCPou } from '../../../middleware/shared/ports/types'
import type { LadderFlowType } from '../slices/ladder'
import type { OpenPLCStore } from '../index'
import { createTestStore } from '../testing'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

/**
 * Store behaviour for Global Variable Lists.
 *
 * Every case rebuilds the project first. The store is a singleton, so without this the
 * cases share tabs, files and pending state, and a regression in the first one surfaces
 * as an unrelated failure three cases later — the load-bearing test order that was just
 * removed from `project-slice.test.ts`.
 */
const resetProject = () => {
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes: [],
      globalVariableLists: [],
      pous: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
}

const variable = (name: string, value = 'BOOL', location = '') => ({
  name,
  class: 'global' as const,
  type: { definition: 'base-type' as const, value },
  location,
  initialValue: '',
  documentation: '',
})

const stPou = (name: string, body: string): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables: [] },
  body: { language: 'st', value: body },
})

const ladderPou = (name: string, variableName: string): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables: [] },
  body: {
    language: 'ld',
    value: {
      name,
      rungs: [
        {
          id: 'rung-1',
          comment: '',
          defaultBounds: [300, 100],
          reactFlowViewport: [300, 100],
          nodes: [{ id: 'c1', type: 'contact', position: { x: 0, y: 0 }, data: { variable: { name: variableName } } }],
          edges: [],
        },
      ],
    },
  },
})

const setListDocumentation = (name: string, documentation: string) => {
  const { project } = store.getState()
  store.getState().projectActions.setProject({
    ...project,
    data: {
      ...project.data,
      globalVariableLists: (project.data.globalVariableLists ?? []).map((l) =>
        l.name === name ? { ...l, documentation } : l,
      ),
    },
  })
}

const setPous = (pous: PLCPou[]) => {
  const { project } = store.getState()
  store.getState().projectActions.setProject({ ...project, data: { ...project.data, pous } })
}

beforeEach(() => {
  resetProject()
})

describe('global variable list — project actions', () => {
  it('creates a list and rejects a duplicate name case-insensitively', () => {
    const { createGlobalVariableList } = store.getState().projectActions

    expect(createGlobalVariableList('GVL').ok).toBe(true)
    expect(store.getState().project.data.globalVariableLists?.map((l) => l.name)).toEqual(['GVL'])

    // `GVL` and `gvl` are one symbol once compiled, so the collision has to be caught here.
    expect(createGlobalVariableList('gvl').ok).toBe(false)
  })

  it('updates and deletes by a case-folded name', () => {
    // A lookup comparing with `===` would miss the list it was handed and return
    // silently, throwing the user's edit away with no error anywhere.
    const { createGlobalVariableList, updateGlobalVariableList, deleteGlobalVariableList } =
      store.getState().projectActions

    createGlobalVariableList('GVL')
    updateGlobalVariableList('gvl', [variable('Output1', 'BOOL', '%QX0.0')])

    const list = store.getState().project.data.globalVariableLists?.[0]
    expect(list?.variables.map((v) => [v.name, v.location])).toEqual([['Output1', '%QX0.0']])

    deleteGlobalVariableList('gVl')
    expect(store.getState().project.data.globalVariableLists).toEqual([])
  })

  it('queues no file deletion — a list has no file of its own', () => {
    // It is persisted inside project.json. A `globals/<name>.gvl` entry would name a
    // path no writer in this codebase ever creates.
    const { createGlobalVariableList, deleteGlobalVariableList } = store.getState().projectActions

    createGlobalVariableList('GVL')
    deleteGlobalVariableList('GVL')

    expect(store.getState().pendingDeletions.some((p) => p.includes('.gvl'))).toBe(false)
  })

  it('sets and clears the qualifier', () => {
    const { createGlobalVariableList, updateGlobalVariableListQualifier } = store.getState().projectActions

    createGlobalVariableList('GVL')
    updateGlobalVariableListQualifier('GVL', 'CONSTANT')
    expect(store.getState().project.data.globalVariableLists?.[0].qualifier).toBe('CONSTANT')

    updateGlobalVariableListQualifier('GVL', undefined)
    expect(store.getState().project.data.globalVariableLists?.[0].qualifier).toBeUndefined()
  })

  it('ignores an update aimed at a list that does not exist', () => {
    const { updateGlobalVariableList, updateGlobalVariableListQualifier, updateGlobalVariableListName } =
      store.getState().projectActions

    updateGlobalVariableList('Nope', [variable('A')])
    updateGlobalVariableListQualifier('Nope', 'CONSTANT')
    updateGlobalVariableListName('Nope', 'Other')

    expect(store.getState().project.data.globalVariableLists).toEqual([])
  })

  it('carries a data type rename into the members of a list', () => {
    // A list member is typed like any other variable and lives on the list, not in
    // `globalVariables` — so it goes stale on a rename unless propagation reaches it.
    const state = store.getState()
    state.projectActions.createGlobalVariableList('GVL')
    state.projectActions.updateGlobalVariableList('GVL', [
      { ...variable('Motor'), type: { definition: 'user-data-type', value: 'MotorState' } },
    ])

    store.getState().projectActions.propagateDatatypeRename('MotorState', 'DriveState')

    expect(store.getState().project.data.globalVariableLists?.[0].variables[0].type.value).toBe('DriveState')
  })
})

describe('global variable list — shared actions', () => {
  it('opens the list right after creating it, like every other + button element', () => {
    const created = store.getState().globalVariableListActions.create('GVL')

    expect(created.ok).toBe(true)
    const after = store.getState()
    // The tab is open, selected, and the editor is pointed at it — creating a list the
    // user then has to hunt for in the tree would be the odd one out.
    expect(after.tabs.some((t) => t.name === 'GVL')).toBe(true)
    expect(after.editor.meta.name).toBe('GVL')
    expect(after.editor.type).toBe('plc-global-variable-list')
  })

  it('deletes a list, closing its tab and model', () => {
    store.getState().globalVariableListActions.create('GVL')
    expect(store.getState().tabs.some((t) => t.name === 'GVL')).toBe(true)

    store.getState().globalVariableListActions.delete('GVL')

    const after = store.getState()
    expect(after.project.data.globalVariableLists?.some((l) => l.name === 'GVL')).toBe(false)
    expect(after.tabs.some((t) => t.name === 'GVL')).toBe(false)
  })

  it('refuses a rename onto a name already taken', () => {
    const actions = store.getState().globalVariableListActions
    actions.create('GVL_A')
    actions.create('GVL_B')

    expect(store.getState().globalVariableListActions.rename('GVL_A', 'gvl_b').ok).toBe(false)
  })

  it('refuses a name that collides across the namespace, not just with other lists', () => {
    // A list occupies two symbols — the instance keeps the user's name, the struct
    // behind it takes `<name>_TYPE` — and both share IEC's one global namespace with
    // every POU and data type.
    setPous([stPou('Main', '')])
    const { project } = store.getState()
    store.getState().projectActions.setProject({
      ...project,
      data: { ...project.data, dataTypes: [{ name: 'MotorState', derivation: 'structure', variable: [] }] },
    })

    const actions = store.getState().globalVariableListActions
    expect(actions.create('Main').message).toMatch(/name of a POU/)
    expect(actions.create('MotorState').message).toMatch(/name of a data type/)
  })

  it('refuses a name whose derived type name is already taken', () => {
    const { project } = store.getState()
    store.getState().projectActions.setProject({
      ...project,
      data: { ...project.data, dataTypes: [{ name: 'Foo_TYPE', derivation: 'structure', variable: [] }] },
    })

    expect(store.getState().globalVariableListActions.create('Foo').message).toMatch(/Foo_TYPE/)
  })

  it('allows a rename that only changes the case of its own name', () => {
    store.getState().globalVariableListActions.create('GVL')

    expect(store.getState().globalVariableListActions.rename('GVL', 'gvl').ok).toBe(true)
  })

  it('rewrites every reference when the list is renamed', () => {
    // Without this the rename leaves `GVL.Output1` pointing at a list that no longer
    // exists, and nothing says so until the compiler does.
    store.getState().globalVariableListActions.create('GVL')
    setPous([stPou('Main', 'GVL.Output1 := TRUE;')])

    const result = store.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(result.ok).toBe(true)
    expect(store.getState().project.data.pous[0].body.value).toBe('Globals.Output1 := TRUE;')
    expect(store.getState().project.data.globalVariableLists?.[0].name).toBe('Globals')
  })

  it('flags every rewritten POU unsaved, or the propagated body never reaches disk', () => {
    store.getState().globalVariableListActions.create('GVL')
    setPous([stPou('Main', 'GVL.Output1 := TRUE;')])
    store.getState().fileActions.addFile({ name: 'Main', type: 'program', filePath: 'Main', isNew: false })
    store.getState().fileActions.setAllToSaved()

    store.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(store.getState().files.Main?.saved).toBe(false)
  })

  it('leaves an unrelated POU untouched by a rename', () => {
    store.getState().globalVariableListActions.create('GVL')
    setPous([stPou('Other', 'x := y + 1;')])

    store.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(store.getState().project.data.pous[0].body.value).toBe('x := y + 1;')
  })

  it('keeps list metadata when a successful parse folds in', () => {
    // The parser only knows what the declaration carries, so replacing the list
    // wholesale would drop `documentation` on the first successful edit.
    const state = store.getState()
    state.globalVariableListActions.create('MetaList')
    state.projectActions.updateGlobalVariableListQualifier('MetaList', 'CONSTANT')
    setListDocumentation('MetaList', 'kept across edits')

    store.getState().editorActions.updateModelStructureForName('MetaList', {
      display: 'code',
      code: 'VAR_GLOBAL\n  A : BOOL;\nEND_VAR\n',
    })
    store.getState().projectActions.reconcileGlobalVariableListText('MetaList')

    const list = store.getState().project.data.globalVariableLists?.[0]
    expect(list?.documentation).toBe('kept across edits')
    expect(list?.variables.map((v) => v.name)).toEqual(['A'])
    // ...but a qualifier the user deleted from the text must not survive the merge.
    expect(list?.qualifier).toBeUndefined()
  })

  it('re-seeds a graphical flow after propagating a rename', () => {
    // The editors read the flow slice, not `pou.body.value`. Without re-seeding, the
    // next debounced write-back copies the stale flow back over the rename.
    store.getState().globalVariableListActions.create('GVL')
    setPous([ladderPou('Rungs', 'GVL.Output1')])
    store.getState().ladderFlowActions.addLadderFlow({
      ...(store.getState().project.data.pous[0].body.value as LadderFlowType),
      name: 'Rungs',
    })

    store.getState().globalVariableListActions.rename('GVL', 'Globals')

    const flow = store.getState().ladderFlows.find((f) => f.name === 'Rungs')
    expect(JSON.stringify(flow)).toContain('Globals.Output1')
    expect(JSON.stringify(flow)).not.toContain('GVL.Output1')
  })

  it('refuses the rename when a graphical write-back failed', () => {
    // A failed write-back leaves `pou.body.value` stale for good, so the scan and the
    // re-seed would both run on pre-edit content and the re-seed would overwrite the
    // newer flow. Undo and redo already refuse on the same signal.
    store.getState().globalVariableListActions.create('GVL')
    setPous([ladderPou('Rungs', 'GVL.Output1')])
    // A flow missing `defaultBounds` / `reactFlowViewport` fails the zod guard.
    store.getState().ladderFlowActions.addLadderFlow({
      name: 'Rungs',
      updated: true,
      rungs: [{ id: 'rung-1', comment: '', nodes: [], edges: [] }],
    } as unknown as LadderFlowType)
    store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'Rungs', updated: true })

    const result = store.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(result.ok).toBe(false)
    expect(String(result.message)).toContain('Rungs')
    // Nothing moved, so a corrected flow can retry the whole rename.
    expect(store.getState().project.data.globalVariableLists?.[0].name).toBe('GVL')
    expect(store.getState().project.data.pous[0].body.value).toBeDefined()
  })

  it('refuses a rename to an invalid identifier', () => {
    store.getState().globalVariableListActions.create('GVL')

    expect(store.getState().globalVariableListActions.rename('GVL', '1bad').ok).toBe(false)
  })
})
