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
