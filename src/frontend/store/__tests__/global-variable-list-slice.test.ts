import { describe, expect, it } from '@jest/globals'
import { useOpenPLCStore } from '../index'

describe('global variable list store actions', () => {
  it('creates a list, rejects a duplicate name case-insensitively, and deletes it', () => {
    const { createGlobalVariableList, updateGlobalVariableList, deleteGlobalVariableList } =
      useOpenPLCStore.getState().projectActions

    expect(createGlobalVariableList('GVL').ok).toBe(true)
    expect(useOpenPLCStore.getState().project.data.globalVariableLists?.map((l) => l.name)).toEqual(['GVL'])

    // `GVL` and `gvl` are one symbol once compiled, so the collision has to be caught here.
    expect(createGlobalVariableList('gvl').ok).toBe(false)

    updateGlobalVariableList('GVL', [
      {
        name: 'Output1',
        class: 'global',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '%QX0.0',
        initialValue: '',
        documentation: '',
      },
    ])
    const list = useOpenPLCStore.getState().project.data.globalVariableLists?.[0]
    expect(list?.variables.map((v) => [v.name, v.location])).toEqual([['Output1', '%QX0.0']])

    deleteGlobalVariableList('GVL')
    expect(useOpenPLCStore.getState().project.data.globalVariableLists).toEqual([])
    expect(useOpenPLCStore.getState().pendingDeletions).toContain('globals/GVL.gvl')
  })
})

describe('global variable list shared actions', () => {
  it('opens the list right after creating it, like every other + button element', () => {
    const state = useOpenPLCStore.getState()
    const created = state.globalVariableListActions.create('GVL2')

    expect(created.ok).toBe(true)
    const after = useOpenPLCStore.getState()
    // The tab is open, selected, and the editor is pointed at it — creating a list the
    // user then has to hunt for in the tree would be the odd one out.
    expect(after.tabs.some((t) => t.name === 'GVL2')).toBe(true)
    expect(after.editor.meta.name).toBe('GVL2')
    expect(after.editor.type).toBe('plc-global-variable-list')
  })

  it('deletes a list, closing its tab and model', () => {
    const state = useOpenPLCStore.getState()
    state.globalVariableListActions.create('GVL3')
    expect(useOpenPLCStore.getState().tabs.some((t) => t.name === 'GVL3')).toBe(true)

    useOpenPLCStore.getState().globalVariableListActions.delete('GVL3')

    const after = useOpenPLCStore.getState()
    expect(after.project.data.globalVariableLists?.some((l) => l.name === 'GVL3')).toBe(false)
    expect(after.tabs.some((t) => t.name === 'GVL3')).toBe(false)
    expect(after.pendingDeletions).toContain('globals/GVL3.gvl')
  })

  it('refuses a rename onto a name already taken', () => {
    const state = useOpenPLCStore.getState()
    state.globalVariableListActions.create('GVL_A')
    state.globalVariableListActions.create('GVL_B')

    const res = useOpenPLCStore.getState().globalVariableListActions.rename('GVL_A', 'gvl_b')
    expect(res.ok).toBe(false)
  })
})
