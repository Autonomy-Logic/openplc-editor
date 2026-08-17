import { beforeEach, describe, expect, it } from '@jest/globals'

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { useOpenPLCStore } from '../index'

/**
 * Store behaviour for Global Variable Lists.
 *
 * Every case rebuilds the project first. The store is a singleton, so without this the
 * cases share tabs, files and pending state, and a regression in the first one surfaces
 * as an unrelated failure three cases later — the load-bearing test order that was just
 * removed from `project-slice.test.ts`.
 */
const resetProject = () => {
  useOpenPLCStore.getState().projectActions.setProject({
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

const setPous = (pous: PLCPou[]) => {
  const { project } = useOpenPLCStore.getState()
  useOpenPLCStore.getState().projectActions.setProject({ ...project, data: { ...project.data, pous } })
}

beforeEach(() => {
  resetProject()
})

describe('global variable list — project actions', () => {
  it('creates a list and rejects a duplicate name case-insensitively', () => {
    const { createGlobalVariableList } = useOpenPLCStore.getState().projectActions

    expect(createGlobalVariableList('GVL').ok).toBe(true)
    expect(useOpenPLCStore.getState().project.data.globalVariableLists?.map((l) => l.name)).toEqual(['GVL'])

    // `GVL` and `gvl` are one symbol once compiled, so the collision has to be caught here.
    expect(createGlobalVariableList('gvl').ok).toBe(false)
  })

  it('updates and deletes by a case-folded name', () => {
    // A lookup comparing with `===` would miss the list it was handed and return
    // silently, throwing the user's edit away with no error anywhere.
    const { createGlobalVariableList, updateGlobalVariableList, deleteGlobalVariableList } =
      useOpenPLCStore.getState().projectActions

    createGlobalVariableList('GVL')
    updateGlobalVariableList('gvl', [variable('Output1', 'BOOL', '%QX0.0')])

    const list = useOpenPLCStore.getState().project.data.globalVariableLists?.[0]
    expect(list?.variables.map((v) => [v.name, v.location])).toEqual([['Output1', '%QX0.0']])

    deleteGlobalVariableList('gVl')
    expect(useOpenPLCStore.getState().project.data.globalVariableLists).toEqual([])
  })

  it('queues no file deletion — a list has no file of its own', () => {
    // It is persisted inside project.json. A `globals/<name>.gvl` entry would name a
    // path no writer in this codebase ever creates.
    const { createGlobalVariableList, deleteGlobalVariableList } = useOpenPLCStore.getState().projectActions

    createGlobalVariableList('GVL')
    deleteGlobalVariableList('GVL')

    expect(useOpenPLCStore.getState().pendingDeletions.some((p) => p.includes('.gvl'))).toBe(false)
  })

  it('sets and clears the qualifier', () => {
    const { createGlobalVariableList, updateGlobalVariableListQualifier } = useOpenPLCStore.getState().projectActions

    createGlobalVariableList('GVL')
    updateGlobalVariableListQualifier('GVL', 'CONSTANT')
    expect(useOpenPLCStore.getState().project.data.globalVariableLists?.[0].qualifier).toBe('CONSTANT')

    updateGlobalVariableListQualifier('GVL', undefined)
    expect(useOpenPLCStore.getState().project.data.globalVariableLists?.[0].qualifier).toBeUndefined()
  })

  it('ignores an update aimed at a list that does not exist', () => {
    const { updateGlobalVariableList, updateGlobalVariableListQualifier, updateGlobalVariableListName } =
      useOpenPLCStore.getState().projectActions

    updateGlobalVariableList('Nope', [variable('A')])
    updateGlobalVariableListQualifier('Nope', 'CONSTANT')
    updateGlobalVariableListName('Nope', 'Other')

    expect(useOpenPLCStore.getState().project.data.globalVariableLists).toEqual([])
  })

  it('carries a data type rename into the members of a list', () => {
    // A list member is typed like any other variable and lives on the list, not in
    // `globalVariables` — so it goes stale on a rename unless propagation reaches it.
    const store = useOpenPLCStore.getState()
    store.projectActions.createGlobalVariableList('GVL')
    store.projectActions.updateGlobalVariableList('GVL', [
      { ...variable('Motor'), type: { definition: 'user-data-type', value: 'MotorState' } },
    ])

    useOpenPLCStore.getState().projectActions.propagateDatatypeRename('MotorState', 'DriveState')

    expect(useOpenPLCStore.getState().project.data.globalVariableLists?.[0].variables[0].type.value).toBe('DriveState')
  })
})

describe('global variable list — shared actions', () => {
  it('opens the list right after creating it, like every other + button element', () => {
    const created = useOpenPLCStore.getState().globalVariableListActions.create('GVL')

    expect(created.ok).toBe(true)
    const after = useOpenPLCStore.getState()
    // The tab is open, selected, and the editor is pointed at it — creating a list the
    // user then has to hunt for in the tree would be the odd one out.
    expect(after.tabs.some((t) => t.name === 'GVL')).toBe(true)
    expect(after.editor.meta.name).toBe('GVL')
    expect(after.editor.type).toBe('plc-global-variable-list')
  })

  it('deletes a list, closing its tab and model', () => {
    useOpenPLCStore.getState().globalVariableListActions.create('GVL')
    expect(useOpenPLCStore.getState().tabs.some((t) => t.name === 'GVL')).toBe(true)

    useOpenPLCStore.getState().globalVariableListActions.delete('GVL')

    const after = useOpenPLCStore.getState()
    expect(after.project.data.globalVariableLists?.some((l) => l.name === 'GVL')).toBe(false)
    expect(after.tabs.some((t) => t.name === 'GVL')).toBe(false)
  })

  it('refuses a rename onto a name already taken', () => {
    const actions = useOpenPLCStore.getState().globalVariableListActions
    actions.create('GVL_A')
    actions.create('GVL_B')

    expect(useOpenPLCStore.getState().globalVariableListActions.rename('GVL_A', 'gvl_b').ok).toBe(false)
  })

  it('refuses a name that collides across the namespace, not just with other lists', () => {
    // A list occupies two symbols — the instance keeps the user's name, the struct
    // behind it takes `<name>_TYPE` — and both share IEC's one global namespace with
    // every POU and data type.
    setPous([stPou('Main', '')])
    const { project } = useOpenPLCStore.getState()
    useOpenPLCStore.getState().projectActions.setProject({
      ...project,
      data: { ...project.data, dataTypes: [{ name: 'MotorState', derivation: 'structure', variable: [] }] },
    })

    const actions = useOpenPLCStore.getState().globalVariableListActions
    expect(actions.create('Main').message).toMatch(/name of a POU/)
    expect(actions.create('MotorState').message).toMatch(/name of a data type/)
  })

  it('refuses a name whose derived type name is already taken', () => {
    const { project } = useOpenPLCStore.getState()
    useOpenPLCStore.getState().projectActions.setProject({
      ...project,
      data: { ...project.data, dataTypes: [{ name: 'Foo_TYPE', derivation: 'structure', variable: [] }] },
    })

    expect(useOpenPLCStore.getState().globalVariableListActions.create('Foo').message).toMatch(/Foo_TYPE/)
  })

  it('allows a rename that only changes the case of its own name', () => {
    useOpenPLCStore.getState().globalVariableListActions.create('GVL')

    expect(useOpenPLCStore.getState().globalVariableListActions.rename('GVL', 'gvl').ok).toBe(true)
  })

  it('rewrites every reference when the list is renamed', () => {
    // Without this the rename leaves `GVL.Output1` pointing at a list that no longer
    // exists, and nothing says so until the compiler does.
    useOpenPLCStore.getState().globalVariableListActions.create('GVL')
    setPous([stPou('Main', 'GVL.Output1 := TRUE;')])

    const result = useOpenPLCStore.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(result.ok).toBe(true)
    expect(useOpenPLCStore.getState().project.data.pous[0].body.value).toBe('Globals.Output1 := TRUE;')
    expect(useOpenPLCStore.getState().project.data.globalVariableLists?.[0].name).toBe('Globals')
  })

  it('flags every rewritten POU unsaved, or the propagated body never reaches disk', () => {
    useOpenPLCStore.getState().globalVariableListActions.create('GVL')
    setPous([stPou('Main', 'GVL.Output1 := TRUE;')])
    useOpenPLCStore.getState().fileActions.addFile({ name: 'Main', type: 'program', filePath: 'Main', isNew: false })
    useOpenPLCStore.getState().fileActions.setAllToSaved()

    useOpenPLCStore.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(useOpenPLCStore.getState().files.Main?.saved).toBe(false)
  })

  it('leaves an unrelated POU untouched by a rename', () => {
    useOpenPLCStore.getState().globalVariableListActions.create('GVL')
    setPous([stPou('Other', 'x := y + 1;')])

    useOpenPLCStore.getState().globalVariableListActions.rename('GVL', 'Globals')

    expect(useOpenPLCStore.getState().project.data.pous[0].body.value).toBe('x := y + 1;')
  })

  it('refuses a rename to an invalid identifier', () => {
    useOpenPLCStore.getState().globalVariableListActions.create('GVL')

    expect(useOpenPLCStore.getState().globalVariableListActions.rename('GVL', '1bad').ok).toBe(false)
  })
})
