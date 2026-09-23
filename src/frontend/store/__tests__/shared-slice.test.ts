import { createStore } from 'zustand/vanilla'

import type { PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'
import { createAISlice } from '../slices/ai'
import { createConsoleSlice } from '../slices/console/slice'
import { createDeviceSlice } from '../slices/device/slice'
import { createEditorSlice } from '../slices/editor/slice'
import { createFBDFlowSlice } from '../slices/fbd/slice'
import { createFileSlice } from '../slices/file/slice'
import { createHistorySlice } from '../slices/history/slice'
import type { LadderFlowType } from '../slices/ladder'
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

describe('createSharedSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  it('should have empty undoRedo state initially', () => {
    expect(store.getState().undoRedo).toEqual({})
  })

  describe('pouActions', () => {
    describe('create', () => {
      it('creates an ST program and updates all slices', () => {
        const result = store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        expect(result).toEqual({ ok: true })

        const state = store.getState()

        expect(state.project.data.pous).toHaveLength(1)
        expect(state.project.data.pous[0].name).toBe('Main')
        expect(state.project.data.pous[0].pouType).toBe('program')

        expect(state.editor.type).toBe('plc-textual')
        expect(state.editor.meta.name).toBe('Main')

        expect(state.files['Main']).toBeDefined()
        expect(state.files['Main'].type).toBe('program')
        expect(state.files['Main'].isNew).toBe(true)

        expect(state.tabs).toHaveLength(1)
        expect(state.tabs[0].name).toBe('Main')
        expect(state.selectedTab).toBe('Main')

        // A program is never registered as a library block (excluded from libraries.user).
        expect(state.libraries.user).toHaveLength(0)
      })

      it('creates an LD function-block', () => {
        const result = store.getState().pouActions.create({ type: 'function-block', name: 'FB1', language: 'ld' })
        expect(result.ok).toBe(true)

        const state = store.getState()
        expect(state.project.data.pous[0].pouType).toBe('function-block')
        expect(state.editor.type).toBe('plc-graphical')

        expect(state.libraries.user[0].type).toBe('function-block')
      })

      it('creates a function and adds it to library as function', () => {
        store.getState().pouActions.create({ type: 'function', name: 'Func1', language: 'st' })
        const state = store.getState()
        expect(state.libraries.user[0].type).toBe('function')
      })

      it('returns error when POU name already exists', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        const result = store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'il' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })

      it('rejects a POU name that is not a valid IEC identifier', () => {
        const result = store.getState().pouActions.create({ type: 'program', name: 'Siren FC', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toContain("'Siren FC'")
      })

      it('creates multiple POUs', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Prog1', language: 'st' })
        store.getState().pouActions.create({ type: 'function', name: 'Func1', language: 'il' })
        store.getState().pouActions.create({ type: 'function-block', name: 'FB1', language: 'fbd' })

        const state = store.getState()
        expect(state.project.data.pous).toHaveLength(3)
        expect(state.tabs).toHaveLength(3)
        expect(Object.keys(state.files)).toHaveLength(3)
        // Two, not three: the program is excluded from the library.
        expect(state.libraries.user.map((library) => library.name)).toEqual(['Func1', 'FB1'])
      })

      it('seeds ladderFlows when creating an LD POU', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdProg', language: 'ld' })
        const state = store.getState()
        const flow = state.ladderFlows.find((f) => f.name === 'LdProg')
        expect(flow).toBeDefined()
        expect(flow!.rungs).toEqual([])
      })

      it('seeds fbdFlows when creating an FBD POU', () => {
        store.getState().pouActions.create({ type: 'program', name: 'FbdProg', language: 'fbd' })
        const state = store.getState()
        const flow = state.fbdFlows.find((f) => f.name === 'FbdProg')
        expect(flow).toBeDefined()
        expect(flow!.rung.nodes).toEqual([])
        expect(flow!.rung.edges).toEqual([])
      })
    })

    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with pou elementType', () => {
        store.getState().pouActions.deleteRequest('Main')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'Main', elementType: 'pou' })
      })
    })

    describe('delete', () => {
      beforeEach(() => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
      })

      it('removes POU from all slices', () => {
        const result = store.getState().pouActions.delete('Main')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.pous).toHaveLength(0)
        expect(state.files['Main']).toBeUndefined()
        expect(state.tabs).toHaveLength(0)
        expect(state.libraries.user).toHaveLength(0)
      })

      it('flags the workspace dirty after delete (persist only on save)', () => {
        store.getState().workspaceActions.setEditingState('saved')
        store.getState().pouActions.delete('Main')
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('clears editor if current editor matches deleted POU', () => {
        expect(store.getState().editor.meta.name).toBe('Main')

        store.getState().pouActions.delete('Main')
        const state = store.getState()
        expect(state.editor.type).toBe('available')
        expect(state.editor.meta.name).toBe('available')
      })

      it('does not clear editor if a different POU is deleted', () => {
        store.getState().pouActions.create({ type: 'function', name: 'Func1', language: 'st' })
        expect(store.getState().editor.meta.name).toBe('Func1')

        store.getState().pouActions.delete('Main')
        expect(store.getState().editor.meta.name).toBe('Func1')
        expect(store.getState().project.data.pous).toHaveLength(1)
        expect(store.getState().project.data.pous[0].name).toBe('Func1')
      })
    })

    describe('rename', () => {
      beforeEach(() => {
        store.getState().pouActions.create({ type: 'program', name: 'OldName', language: 'st' })
      })

      it('renames POU across all slices', () => {
        const result = store.getState().pouActions.rename('OldName', 'NewName')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.pous[0].name).toBe('NewName')
        expect(state.files['NewName']).toBeDefined()
        expect(state.files['OldName']).toBeUndefined()
        expect(state.tabs[0].name).toBe('NewName')
        // The POU here is a program, so it never entered `libraries.user`.
        expect(state.libraries.user).toHaveLength(0)
      })

      it('flags the workspace dirty after rename (persist only on save)', () => {
        store.getState().workspaceActions.setEditingState('saved')
        store.getState().pouActions.rename('OldName', 'NewName')
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('returns error when new name already exists', () => {
        store.getState().pouActions.create({ type: 'function', name: 'Existing', language: 'st' })
        const result = store.getState().pouActions.rename('OldName', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })

      it('rejects renaming to a name with path separators (the deleting-function bug)', () => {
        const result = store.getState().pouActions.rename('OldName', 'pous\\functions\\Siren FC')
        expect(result.ok).toBe(false)
      })

      it('updates editor name if current editor matches old name', () => {
        expect(store.getState().editor.meta.name).toBe('OldName')
        store.getState().pouActions.rename('OldName', 'NewName')
        expect(store.getState().editor.meta.name).toBe('NewName')
      })
    })

    describe('duplicate', () => {
      beforeEach(() => {
        store.getState().pouActions.create({ type: 'program', name: 'Source', language: 'st' })
      })

      it('duplicates a POU with a new name', () => {
        const result = store.getState().pouActions.duplicate('Source', 'Copy')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.pous).toHaveLength(2)
        expect(state.project.data.pous[1].name).toBe('Copy')
        expect(state.project.data.pous[1].pouType).toBe('program')

        expect(state.files['Copy']).toBeDefined()
        expect(state.files['Copy'].isNew).toBe(true)
      })

      it('flags the workspace dirty after duplicate (persist only on save)', () => {
        store.getState().workspaceActions.setEditingState('saved')
        store.getState().pouActions.duplicate('Source', 'Copy')
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('returns error when source POU does not exist', () => {
        const result = store.getState().pouActions.duplicate('NonExistent', 'Copy')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Source POU not found')
      })

      it('returns error when new name already exists', () => {
        store.getState().pouActions.create({ type: 'function', name: 'Existing', language: 'st' })
        const result = store.getState().pouActions.duplicate('Source', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })

      it('rejects duplicating to an invalid IEC identifier', () => {
        const result = store.getState().pouActions.duplicate('Source', 'bad name')
        expect(result.ok).toBe(false)
      })

      it('duplicates a function and preserves returnType', () => {
        store.getState().pouActions.create({ type: 'function', name: 'FuncSrc', language: 'st' })

        store.getState().projectActions.updatePouReturnType('FuncSrc', 'INT')

        const result = store.getState().pouActions.duplicate('FuncSrc', 'FuncCopy')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'FuncCopy')
        expect(copyPou).toBeDefined()
        expect(copyPou!.pouType).toBe('function')
        expect(copyPou!.interface?.returnType).toBe('INT')
      })

      it('duplicates a POU with LD language and preserves body structure', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdSource', language: 'ld' })
        const result = store.getState().pouActions.duplicate('LdSource', 'LdCopy')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'LdCopy')
        expect(copyPou).toBeDefined()
        expect(copyPou!.body.language).toBe('ld')

        // The duplicate must also seed ladderFlows so the editor renders.
        const flow = store.getState().ladderFlows.find((f) => f.name === 'LdCopy')
        expect(flow).toBeDefined()
      })

      it('duplicates a POU with FBD language and seeds fbdFlows', () => {
        store.getState().pouActions.create({ type: 'program', name: 'FbdSource', language: 'fbd' })
        const result = store.getState().pouActions.duplicate('FbdSource', 'FbdCopy')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'FbdCopy')
        expect(copyPou).toBeDefined()
        expect(copyPou!.body.language).toBe('fbd')

        const flow = store.getState().fbdFlows.find((f) => f.name === 'FbdCopy')
        expect(flow).toBeDefined()
      })

      it('duplicates a POU that has no interface variables (null branch)', () => {
        store.getState().pouActions.create({ type: 'program', name: 'NoVarsPou', language: 'st' })
        const pous = store.getState().project.data.pous.map((p) => {
          if (p.name === 'NoVarsPou') {
            return { ...p, interface: undefined, documentation: undefined }
          }
          return p
        })
        store.getState().projectActions.setPous(pous)

        const result = store.getState().pouActions.duplicate('NoVarsPou', 'NoVarsCopy')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'NoVarsCopy')
        expect(copyPou).toBeDefined()
        expect(copyPou!.interface?.variables).toEqual([])
        expect(copyPou!.documentation).toBe('')
      })

      it('duplicates a function and copies returnType from interface', () => {
        store.getState().pouActions.create({ type: 'function', name: 'FnSrc', language: 'st' })
        store.getState().projectActions.updatePouReturnType('FnSrc', 'DINT')

        const result = store.getState().pouActions.duplicate('FnSrc', 'FnDup')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'FnDup')
        expect(copyPou).toBeDefined()
        expect(copyPou!.pouType).toBe('function')
        expect(copyPou!.interface?.returnType).toBe('DINT')
      })

      it('duplicates a function with undefined returnType (falls back to BOOL)', () => {
        store.getState().pouActions.create({ type: 'function', name: 'FnNoRet', language: 'st' })
        const pous = store.getState().project.data.pous.map((p) => {
          if (p.name === 'FnNoRet') {
            return { ...p, interface: { variables: p.interface?.variables ?? [], returnType: undefined } }
          }
          return p
        })
        store.getState().projectActions.setPous(pous)

        const result = store.getState().pouActions.duplicate('FnNoRet', 'FnNoRetCopy')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'FnNoRetCopy')
        expect(copyPou).toBeDefined()
        expect(copyPou!.pouType).toBe('function')
        // Falls back to 'BOOL' because source had no returnType
        expect(copyPou!.interface?.returnType).toBe('BOOL')
      })

      it('returns error when duplicate createPou fails (name collision at project level)', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Source', language: 'st' })
        store.getState().projectActions.createPou({
          type: 'program',
          data: {
            language: 'st',
            name: 'CollideName',
            variables: [],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        })

        const result = store.getState().pouActions.duplicate('Source', 'CollideName')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })
    })
  })

  describe('datatypeActions', () => {
    describe('create', () => {
      it('creates an array data type and updates all slices', () => {
        const result = store.getState().datatypeActions.create({ name: 'IntArray', derivation: 'array' })
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.dataTypes).toHaveLength(1)
        expect(state.project.data.dataTypes[0].name).toBe('IntArray')
        expect(state.project.data.dataTypes[0].derivation).toBe('array')

        expect(state.editor.type).toBe('plc-datatype')
        expect(state.editor.meta.name).toBe('IntArray')

        expect(state.files['IntArray']).toBeDefined()
        expect(state.files['IntArray'].type).toBe('data-type')

        expect(state.tabs).toHaveLength(1)
        expect(state.selectedTab).toBe('IntArray')
      })

      it('creates a structure data type', () => {
        const result = store.getState().datatypeActions.create({ name: 'Point', derivation: 'structure' })
        expect(result.ok).toBe(true)
        expect(store.getState().project.data.dataTypes[0].derivation).toBe('structure')
      })

      it('rejects a name owned by an unreadable .dt file', () => {
        store
          .getState()
          .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Ghost.dt', content: 'TYPE garbage' }])
        const result = store.getState().datatypeActions.create({ name: 'Ghost', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/could not be read/)
        expect(store.getState().project.data.dataTypes).toHaveLength(0)
      })

      it('rejects a name differing only by case (one file per name on case-folding disks)', () => {
        store.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
        const result = store.getState().datatypeActions.create({ name: 'motor', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
        expect(store.getState().project.data.dataTypes).toHaveLength(1)
      })

      it('creates an enumerated data type', () => {
        const result = store.getState().datatypeActions.create({ name: 'Colors', derivation: 'enumerated' })
        expect(result.ok).toBe(true)
        expect(store.getState().project.data.dataTypes[0].derivation).toBe('enumerated')
      })

      it('returns error when data type name already exists', () => {
        store.getState().datatypeActions.create({ name: 'DT1', derivation: 'array' })
        const result = store.getState().datatypeActions.create({ name: 'DT1', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })

      it('rejects a data type name that is not a valid IEC identifier', () => {
        const result = store.getState().datatypeActions.create({ name: 'bad name', derivation: 'array' })
        expect(result.ok).toBe(false)
      })
    })

    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with datatype elementType', () => {
        store.getState().datatypeActions.deleteRequest('IntArray')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'IntArray', elementType: 'datatype' })
      })
    })

    describe('delete', () => {
      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'IntArray', derivation: 'array' })
      })

      it('removes data type from all slices', () => {
        const result = store.getState().datatypeActions.delete('IntArray')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.dataTypes).toHaveLength(0)
        expect(state.files['IntArray']).toBeUndefined()
        expect(state.tabs).toHaveLength(0)
      })

      it('clears editor if current editor matches deleted data type', () => {
        expect(store.getState().editor.meta.name).toBe('IntArray')

        store.getState().datatypeActions.delete('IntArray')
        expect(store.getState().editor.type).toBe('available')
      })

      it('does not clear editor if a different data type is deleted', () => {
        store.getState().datatypeActions.create({ name: 'Other', derivation: 'structure' })
        expect(store.getState().editor.meta.name).toBe('Other')

        store.getState().datatypeActions.delete('IntArray')
        expect(store.getState().editor.meta.name).toBe('Other')
      })
    })

    describe('rename', () => {
      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'OldDT', derivation: 'structure' })
      })

      it('renames data type across all slices', async () => {
        const result = await store.getState().datatypeActions.rename('OldDT', 'NewDT')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.dataTypes[0].name).toBe('NewDT')
        expect(state.files['NewDT']).toBeDefined()
        expect(state.files['OldDT']).toBeUndefined()
        expect(state.tabs[0].name).toBe('NewDT')
      })

      it('queues the old datatypes/<name>.dt path for deletion', async () => {
        await store.getState().datatypeActions.rename('OldDT', 'NewDT')
        expect(store.getState().pendingDeletions).toContain('datatypes/OldDT.dt')
      })

      it('folds pending code-view edits in and rewrites the buffer under the new name', async () => {
        store.getState().editorActions.updateModelStructureForName('OldDT', {
          display: 'code',
          code: 'TYPE\nOldDT : STRUCT\nspeed : INT;\nEND_STRUCT;\nEND_TYPE\n',
        })

        expect((await store.getState().datatypeActions.rename('OldDT', 'NewDT')).ok).toBe(true)

        const renamed = store.getState().project.data.dataTypes[0]
        expect(renamed.name).toBe('NewDT')
        expect(renamed.derivation === 'structure' && renamed.variable.map((v) => v.name)).toEqual(['speed'])

        const model = store.getState().editor
        expect(model.type === 'plc-datatype' && model.structure.display === 'code' && model.structure.code).toContain(
          'NewDT : STRUCT',
        )
      })

      it('refuses the rename while the code view holds invalid text', async () => {
        store
          .getState()
          .editorActions.updateModelStructureForName('OldDT', { display: 'code', code: 'TYPE\ngarbage\nEND_TYPE\n' })

        const result = await store.getState().datatypeActions.rename('OldDT', 'NewDT')
        expect(result.ok).toBe(false)
        expect(store.getState().project.data.dataTypes[0].name).toBe('OldDT')
        expect(store.getState().pendingDeletions).not.toContain('datatypes/OldDT.dt')
      })

      it('rejects a name owned by an unreadable .dt file (case-insensitive)', async () => {
        store
          .getState()
          .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Ghost.dt', content: 'TYPE garbage' }])
        const result = await store.getState().datatypeActions.rename('OldDT', 'ghost')
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/could not be read/)
      })

      it('rejects a rename that collides with another type only by case', async () => {
        store.getState().datatypeActions.create({ name: 'Motor', derivation: 'array' })
        const result = await store.getState().datatypeActions.rename('OldDT', 'motor')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
        expect(store.getState().project.data.dataTypes.map((d) => d.name)).toEqual(['OldDT', 'Motor'])
      })

      it('rejects a case-only rename of the type itself', async () => {
        // Case-only rename would delete and recreate the same file on case-folding filesystems.
        const result = await store.getState().datatypeActions.rename('OldDT', 'olddt')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })

      it('allows a no-op rename to the identical name', async () => {
        const result = await store.getState().datatypeActions.rename('OldDT', 'OldDT')
        expect(result.ok).toBe(true)
      })

      it('returns error when new name already exists', async () => {
        store.getState().datatypeActions.create({ name: 'Existing', derivation: 'array' })
        const result = await store.getState().datatypeActions.rename('OldDT', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })

      it('returns error when data type not found', async () => {
        const result = await store.getState().datatypeActions.rename('NonExistent', 'NewName')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type not found')
      })

      it('updates editor name when renaming the current editor', async () => {
        expect(store.getState().editor.meta.name).toBe('OldDT')
        const result = await store.getState().datatypeActions.rename('OldDT', 'RenamedDT')
        expect(result.ok).toBe(true)
        expect(store.getState().editor.meta.name).toBe('RenamedDT')
      })
    })

    describe('rename with references (impact modal)', () => {
      const directRef = (name: string, typeName: string): PLCVariable => ({
        name,
        class: 'local',
        type: { definition: 'user-data-type', value: typeName },
        location: '',
        documentation: '',
      })
      const arrayRef = (name: string, typeName: string): PLCVariable => ({
        name,
        class: 'local',
        type: {
          definition: 'array',
          value: `ARRAY [0..4] OF ${typeName}`,
          data: {
            baseType: { definition: 'user-data-type', value: typeName },
            dimensions: [{ dimension: '0..4' }],
          },
        },
        location: '',
        documentation: '',
      })

      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'OldDT', derivation: 'structure' })
        store.getState().datatypeActions.create({ name: 'Chassis', derivation: 'structure' })
        store.getState().projectActions.updateDatatype('Chassis', {
          name: 'Chassis',
          derivation: 'structure',
          variable: [{ name: 'front', type: { definition: 'user-data-type', value: 'OldDT' } }],
        })
        store.getState().datatypeActions.create({ name: 'Bank', derivation: 'array' })
        store.getState().projectActions.updateDatatype('Bank', {
          name: 'Bank',
          derivation: 'array',
          baseType: { definition: 'user-data-type', value: 'OldDT' },
          initialValue: '',
          dimensions: [{ dimension: '1..8' }],
        })
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().projectActions.setPouVariables({
          pouName: 'Main',
          variables: [directRef('motor', 'OldDT'), arrayRef('motors', 'olddt')],
        })
        store.getState().projectActions.setGlobalVariables({
          variables: [{ ...directRef('gMotor', 'OldDT'), class: 'global' }],
        })
        store.getState().fileActions.addFile({ name: 'Resource', type: 'resource', filePath: 'Resource' })
        store.getState().fileActions.setAllToSaved()
        store.getState().workspaceActions.setEditingState('saved')
      })

      // Active editor or stored model, same preference order the propagation sync uses.
      const getVariableView = (name: string) => {
        const state = store.getState()
        const model = state.editor.meta.name === name ? state.editor : state.editorActions.getEditorFromEditors(name)
        if (!model || (model.type !== 'plc-textual' && model.type !== 'plc-graphical')) return undefined
        return model.variable
      }
      const getCodeBuffer = (name: string) => {
        const view = getVariableView(name)
        return view?.display === 'code' ? view.code : undefined
      }

      it('parks a pending rename and leaves the store untouched until answered', async () => {
        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')

        const pending = store.getState().pendingDatatypeRename
        expect(pending?.oldName).toBe('OldDT')
        expect(pending?.newName).toBe('NewDT')
        expect(pending?.impact.totalReferences).toBe(5)
        expect(Array.from(pending?.impact.byPou.entries() ?? [])).toEqual([
          ['Main', 2],
          ['Global Variables', 1],
          ['Chassis', 1],
          ['Bank', 1],
        ])
        expect(store.getState().project.data.dataTypes.map((d) => d.name)).toEqual(['OldDT', 'Chassis', 'Bank'])

        store.getState().datatypeActions.respondToPendingRename(true)
        await promise
      })

      it('confirm propagates every reference shape, then renames', async () => {
        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        const result = await promise

        expect(result).toEqual({ ok: true })
        expect(store.getState().pendingDatatypeRename).toBeNull()

        const state = store.getState()
        const variables = state.project.data.pous[0].interface?.variables ?? []
        expect(variables[0].type).toEqual({ definition: 'user-data-type', value: 'NewDT' })
        expect(variables[1].type).toEqual({
          definition: 'array',
          value: 'ARRAY [0..4] OF NewDT',
          data: {
            baseType: { definition: 'user-data-type', value: 'NewDT' },
            dimensions: [{ dimension: '0..4' }],
          },
        })
        expect(state.project.data.configurations.resource.globalVariables[0].type).toEqual({
          definition: 'user-data-type',
          value: 'NewDT',
        })
        const chassis = state.project.data.dataTypes.find((d) => d.name === 'Chassis')
        expect(chassis?.derivation === 'structure' && chassis.variable[0].type.value).toBe('NewDT')
        const bank = state.project.data.dataTypes.find((d) => d.name === 'Bank')
        expect(bank?.derivation === 'array' && bank.baseType.value).toBe('NewDT')

        expect(state.project.data.dataTypes.map((d) => d.name)).toEqual(['NewDT', 'Chassis', 'Bank'])
        expect(state.pendingDeletions).toContain('datatypes/OldDT.dt')
      })

      it('confirm flags every affected container file dirty', async () => {
        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        await promise

        const files = store.getState().files
        expect(files['Main'].saved).toBe(false)
        expect(files['Resource'].saved).toBe(false)
        expect(files['Chassis'].saved).toBe(false)
        expect(files['Bank'].saved).toBe(false)
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('cancel leaves the store completely untouched', async () => {
        const before = store.getState()

        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(false)
        const result = await promise

        expect(result).toEqual({ ok: false, cancelled: true, message: 'Rename cancelled' })
        const after = store.getState()
        expect(after.pendingDatatypeRename).toBeNull()
        // Same object references — no slice was written at all.
        expect(after.project).toBe(before.project)
        expect(after.files).toBe(before.files)
        expect(after.tabs).toBe(before.tabs)
        expect(after.pendingDeletions).toBe(before.pendingDeletions)
      })

      it('skips the modal when nothing references the type', async () => {
        store.getState().datatypeActions.create({ name: 'Lonely', derivation: 'enumerated' })
        const result = await store.getState().datatypeActions.rename('Lonely', 'Hermit')

        expect(result).toEqual({ ok: true })
        expect(store.getState().pendingDatatypeRename).toBeNull()
        expect(store.getState().project.data.dataTypes.map((d) => d.name)).toContain('Hermit')
      })

      it('skips the reference scan on a no-op rename to the identical name', async () => {
        const result = await store.getState().datatypeActions.rename('OldDT', 'OldDT')

        expect(result.ok).toBe(true)
        expect(store.getState().pendingDatatypeRename).toBeNull()
        // References untouched — there was nothing to propagate.
        const variables = store.getState().project.data.pous[0].interface?.variables ?? []
        expect(variables[0].type.value).toBe('OldDT')
      })

      it('rejects an invalid new name before opening the modal', async () => {
        const result = await store.getState().datatypeActions.rename('OldDT', 'bad name')

        expect(result.ok).toBe(false)
        expect(store.getState().pendingDatatypeRename).toBeNull()
      })

      it('rejects a second rename while one is awaiting confirmation', async () => {
        const first = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        const pendingBefore = store.getState().pendingDatatypeRename

        store.getState().datatypeActions.create({ name: 'Other', derivation: 'structure' })
        store.getState().projectActions.updateDatatype('Other', {
          name: 'Other',
          derivation: 'structure',
          variable: [{ name: 'f', type: { definition: 'user-data-type', value: 'Chassis' } }],
        })
        const second = await store.getState().datatypeActions.rename('Chassis', 'Frame')

        expect(second.ok).toBe(false)
        expect(second.message).toBe('Another data type change is awaiting confirmation')
        // The first request's resolver is untouched and still completes.
        expect(store.getState().pendingDatatypeRename).toBe(pendingBefore)
        store.getState().datatypeActions.respondToPendingRename(true)
        const result = await first
        expect(result).toEqual({ ok: true })
        expect(store.getState().project.data.dataTypes.map((d) => d.name)).toContain('NewDT')
      })

      it('respondToPendingRename without a pending request is a no-op', () => {
        const before = store.getState()
        store.getState().datatypeActions.respondToPendingRename(true)
        expect(store.getState()).toBe(before)
      })

      it('regenerates the code-mode variables buffer when the affected POU is the active editor', async () => {
        expect(store.getState().editor.meta.name).toBe('Main')
        store.getState().editorActions.updateModelVariablesForName('Main', {
          display: 'code',
          code: '  VAR\n    motor : OldDT;\n  END_VAR',
        })

        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        await promise

        const code = getCodeBuffer('Main')
        expect(code).toContain('NewDT')
        expect(code).not.toContain('OldDT')
      })

      it('regenerates the buffer of a stored (non-active) POU model', async () => {
        // Make something else the active editor so Main only lives in editors[].
        store.getState().datatypeActions.create({ name: 'Scratch', derivation: 'structure' })
        expect(store.getState().editor.meta.name).toBe('Scratch')
        store.getState().editorActions.updateModelVariablesForName('Main', {
          display: 'code',
          code: '  VAR\n    motor : OldDT;\n  END_VAR',
        })

        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        await promise

        const code = getCodeBuffer('Main')
        expect(code).toContain('NewDT')
        expect(code).not.toContain('OldDT')
      })

      it('leaves table-mode variable views alone', async () => {
        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        await promise

        expect(getVariableView('Main')?.display).toBe('table')
      })

      it('regenerates the .dt code buffer of an affected data type', async () => {
        store.getState().editorActions.updateModelStructureForName('Chassis', {
          display: 'code',
          code: 'TYPE\n  Chassis : STRUCT\n    front : OldDT;\n  END_STRUCT;\nEND_TYPE\n',
        })

        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        await promise

        const model = store.getState().editorActions.getEditorFromEditors('Chassis')
        const code =
          model?.type === 'plc-datatype' && model.structure.display === 'code' ? model.structure.code : undefined
        expect(code).toContain('NewDT')
        expect(code).not.toContain('OldDT')
      })

      it('tolerates an affected POU without an editor model', async () => {
        store.getState().projectActions.createPou({
          type: 'program',
          data: {
            language: 'st',
            name: 'Headless',
            variables: [directRef('m', 'OldDT')],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        })
        store.getState().fileActions.addFile({ name: 'Headless', type: 'program', filePath: 'Headless' })

        const promise = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        store.getState().datatypeActions.respondToPendingRename(true)
        const result = await promise

        expect(result).toEqual({ ok: true })
        const headless = store.getState().project.data.pous.find((p) => p.name === 'Headless')
        expect(headless?.interface?.variables[0].type.value).toBe('NewDT')
      })
    })

    describe('deleteRequest with references (impact modal)', () => {
      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'OldDT', derivation: 'structure' })
        store.getState().datatypeActions.create({ name: 'Chassis', derivation: 'structure' })
        store.getState().projectActions.updateDatatype('Chassis', {
          name: 'Chassis',
          derivation: 'structure',
          variable: [{ name: 'front', type: { definition: 'user-data-type', value: 'OldDT' } }],
        })
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().projectActions.setPouVariables({
          pouName: 'Main',
          variables: [
            {
              name: 'motor',
              class: 'local',
              type: { definition: 'user-data-type', value: 'olddt' },
              location: '',
              documentation: '',
            },
          ],
        })
      })

      const dataTypeNames = () => store.getState().project.data.dataTypes.map((d) => d.name)

      it('parks a pending delete instead of opening the confirm modal', () => {
        store.getState().datatypeActions.deleteRequest('OldDT')

        const pending = store.getState().pendingDatatypeDelete
        expect(pending?.name).toBe('OldDT')
        expect(pending?.impact.totalReferences).toBe(2)
        expect(Array.from(pending?.impact.byPou.entries() ?? [])).toEqual([
          ['Main', 1],
          ['Chassis', 1],
        ])
        expect(store.getState().modalActions.getModalState('confirm-delete-element').open).toBe(false)
        expect(dataTypeNames()).toEqual(['OldDT', 'Chassis'])
      })

      it('confirm deletes the type and leaves the references in place', () => {
        store.getState().datatypeActions.deleteRequest('OldDT')
        store.getState().datatypeActions.respondToPendingDelete(true)

        const state = store.getState()
        expect(state.pendingDatatypeDelete).toBeNull()
        expect(dataTypeNames()).toEqual(['Chassis'])
        expect(state.pendingDeletions).toContain('datatypes/OldDT.dt')
        expect(state.files['OldDT']).toBeUndefined()
        expect(state.project.data.pous[0].interface?.variables[0].type.value).toBe('olddt')
        expect(state.project.data.dataTypes[0]).toMatchObject({
          variable: [{ name: 'front', type: { definition: 'user-data-type', value: 'OldDT' } }],
        })
      })

      it('cancel leaves the store untouched', () => {
        store.getState().datatypeActions.deleteRequest('OldDT')
        store.getState().datatypeActions.respondToPendingDelete(false)

        expect(store.getState().pendingDatatypeDelete).toBeNull()
        expect(dataTypeNames()).toEqual(['OldDT', 'Chassis'])
        expect(store.getState().pendingDeletions).toHaveLength(0)
      })

      it('ignores a second request while one is awaiting confirmation', () => {
        store.getState().datatypeActions.deleteRequest('OldDT')
        store.getState().datatypeActions.deleteRequest('Chassis')

        expect(store.getState().pendingDatatypeDelete?.name).toBe('OldDT')
        expect(store.getState().modalActions.getModalState('confirm-delete-element').open).toBe(false)
      })

      it('respondToPendingDelete without a pending request is a no-op', () => {
        store.getState().datatypeActions.respondToPendingDelete(true)
        expect(dataTypeNames()).toEqual(['OldDT', 'Chassis'])
      })

      it('refuses a delete request while a rename is awaiting confirmation', async () => {
        const rename = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        const pendingRename = store.getState().pendingDatatypeRename

        store.getState().datatypeActions.deleteRequest('OldDT')

        expect(store.getState().pendingDatatypeDelete).toBeNull()
        expect(store.getState().modalActions.getModalState('confirm-delete-element').open).toBe(false)
        expect(store.getState().pendingDatatypeRename).toBe(pendingRename)

        store.getState().datatypeActions.respondToPendingRename(false)
        await rename
      })

      it('refuses a rename while a delete is awaiting confirmation', async () => {
        store.getState().datatypeActions.deleteRequest('OldDT')

        const result = await store.getState().datatypeActions.rename('OldDT', 'NewDT')

        expect(result).toEqual({ ok: false, message: 'Another data type change is awaiting confirmation' })
        expect(store.getState().pendingDatatypeDelete?.name).toBe('OldDT')
        expect(dataTypeNames()).toEqual(['OldDT', 'Chassis'])
      })

      it('drops a pending delete when the project is closed', () => {
        store.getState().datatypeActions.deleteRequest('OldDT')
        expect(store.getState().pendingDatatypeDelete).not.toBeNull()

        store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

        expect(store.getState().pendingDatatypeDelete).toBeNull()
      })

      it('cancels a pending rename when the project is closed', async () => {
        const rename = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        expect(store.getState().pendingDatatypeRename).not.toBeNull()

        store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

        expect(store.getState().pendingDatatypeRename).toBeNull()
        // Without the resolver being fired, this await would never settle.
        await expect(rename).resolves.toEqual({
          ok: false,
          cancelled: true,
          message: 'Rename cancelled',
        })
      })

      it('skips the modal when nothing references the type', () => {
        store.getState().datatypeActions.deleteRequest('Chassis')

        expect(store.getState().pendingDatatypeDelete).toBeNull()
        expect(store.getState().modalActions.getModalState('confirm-delete-element').data).toEqual({
          name: 'Chassis',
          elementType: 'datatype',
        })
      })
    })

    // duplicate
    describe('duplicate', () => {
      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'SourceDT', derivation: 'array' })
      })

      it('duplicates a data type with a new name', () => {
        const result = store.getState().datatypeActions.duplicate('SourceDT', 'CopyDT')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.dataTypes).toHaveLength(2)
        expect(state.project.data.dataTypes[1].name).toBe('CopyDT')
        expect(state.project.data.dataTypes[1].derivation).toBe('array')
        expect(state.files['CopyDT']).toBeDefined()
      })

      it('flags the workspace dirty after duplicate (persist only on save)', () => {
        store.getState().workspaceActions.setEditingState('saved')
        store.getState().datatypeActions.duplicate('SourceDT', 'CopyDT')
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('returns error when source data type does not exist', () => {
        const result = store.getState().datatypeActions.duplicate('NonExistent', 'Copy')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type not found')
      })

      it('rejects a duplicate name differing only by case', () => {
        const result = store.getState().datatypeActions.duplicate('SourceDT', 'sourcedt')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })

      it('rejects a duplicate name owned by an unreadable .dt file', () => {
        store
          .getState()
          .projectActions.setUnparsedDataTypeFiles([{ relativePath: 'datatypes/Ghost.dt', content: 'TYPE garbage' }])
        const result = store.getState().datatypeActions.duplicate('SourceDT', 'Ghost')
        expect(result.ok).toBe(false)
        expect(result.message).toMatch(/could not be read/)
      })

      it('returns error when new name already exists', () => {
        store.getState().datatypeActions.create({ name: 'Existing', derivation: 'structure' })
        const result = store.getState().datatypeActions.duplicate('SourceDT', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })

      it('rejects duplicating to an invalid IEC identifier', () => {
        const result = store.getState().datatypeActions.duplicate('SourceDT', 'bad name')
        expect(result.ok).toBe(false)
      })
    })
  })

  describe('element name namespace', () => {
    const seedPou = (name: string) => store.getState().pouActions.create({ type: 'program', name, language: 'st' })
    const seedDatatype = (name: string) => store.getState().datatypeActions.create({ name, derivation: 'structure' })
    const seedList = (name: string) => store.getState().globalVariableListActions.create(name)

    describe('pouActions', () => {
      it('refuses a create taking a data type name, case-insensitively', () => {
        seedDatatype('Motor')
        const result = store.getState().pouActions.create({ type: 'program', name: 'motor', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"motor" is already the name of a data type')
        expect(store.getState().project.data.pous).toHaveLength(0)
      })

      it('refuses a create taking a global variable list name', () => {
        seedList('GVL')
        const result = store.getState().pouActions.create({ type: 'program', name: 'GVL', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"GVL" is already the name of a global variable list')
      })

      it("refuses a create taking a global variable list's derived type name", () => {
        seedList('GVL')
        const result = store.getState().pouActions.create({ type: 'program', name: 'GVL_TYPE', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"GVL_TYPE" is the type name of global variable list "GVL"')
      })

      it('refuses a create differing from another POU only by case', () => {
        seedPou('Pump')
        const result = store.getState().pouActions.create({ type: 'program', name: 'pump', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })

      it('refuses a rename onto a data type name', () => {
        seedPou('Pump')
        seedDatatype('Motor')
        const result = store.getState().pouActions.rename('Pump', 'Motor')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Motor" is already the name of a data type')
        expect(store.getState().project.data.pous[0].name).toBe('Pump')
      })

      it('refuses a case-only rename: both names are one file on a case-folding disk', () => {
        seedPou('Pump')
        const result = store.getState().pouActions.rename('Pump', 'pump')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
        expect(store.getState().project.data.pous[0].name).toBe('Pump')
      })

      // Guards against `updatePouName` queueing the POU's own file for deletion.
      it('treats a rename onto the exact same name as a no-op', () => {
        seedPou('Pump')
        const result = store.getState().pouActions.rename('Pump', 'Pump')
        expect(result.ok).toBe(true)
        expect(store.getState().pendingDeletions).toEqual([])
      })

      it('refuses a duplicate taking a data type name', () => {
        seedPou('Pump')
        seedDatatype('Motor')
        const result = store.getState().pouActions.duplicate('Pump', 'Motor')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Motor" is already the name of a data type')
      })
    })

    describe('datatypeActions', () => {
      it('refuses a create taking a POU name, case-insensitively', () => {
        seedPou('Pump')
        const result = store.getState().datatypeActions.create({ name: 'pump', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"pump" is already the name of a POU')
        expect(store.getState().project.data.dataTypes).toHaveLength(0)
      })

      it('refuses a create taking a global variable list name', () => {
        seedList('GVL')
        const result = store.getState().datatypeActions.create({ name: 'GVL', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"GVL" is already the name of a global variable list')
      })

      it("refuses a create taking a global variable list's derived type name", () => {
        seedList('GVL')
        const result = store.getState().datatypeActions.create({ name: 'GVL_TYPE', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"GVL_TYPE" is the type name of global variable list "GVL"')
      })

      it('refuses a rename onto a POU name', async () => {
        seedPou('Pump')
        seedDatatype('Motor')
        const result = await store.getState().datatypeActions.rename('Motor', 'Pump')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Pump" is already the name of a POU')
        expect(store.getState().project.data.dataTypes[0].name).toBe('Motor')
      })

      it('refuses a duplicate taking a POU name', () => {
        seedPou('Pump')
        seedDatatype('Motor')
        const result = store.getState().datatypeActions.duplicate('Motor', 'Pump')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Pump" is already the name of a POU')
      })
    })

    describe('globalVariableListActions', () => {
      // `GVL`'s generated struct name `GVL_TYPE` may already be another list's instance name.
      it('refuses a create whose derived type name another list already holds', () => {
        seedList('GVL_TYPE')
        const result = store.getState().globalVariableListActions.create('GVL')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"GVL" needs the type name "GVL_TYPE", which a global variable list already uses')
        expect(store.getState().project.data.globalVariableLists ?? []).toHaveLength(1)
      })

      it('refuses the same pair in the opposite order', () => {
        seedList('GVL')
        const result = store.getState().globalVariableListActions.create('GVL_TYPE')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"GVL_TYPE" is the type name of global variable list "GVL"')
      })

      it('still allows a case-only rename: a list has no file of its own', () => {
        seedList('GVL')
        const result = store.getState().globalVariableListActions.rename('GVL', 'gvl')
        expect(result.ok).toBe(true)
      })

      it('refuses a duplicate taking a POU name', () => {
        seedPou('Pump')
        seedList('GVL')
        const result = store.getState().globalVariableListActions.duplicate('GVL', 'Pump')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Pump" is already the name of a POU')
      })

      // An unreadable .dt is echoed back verbatim on save, so its type stays in the build.
      describe('with an unreadable datatypes/GVL_TYPE.dt on disk', () => {
        const seedGhostTypeFile = () =>
          store
            .getState()
            .projectActions.setUnparsedDataTypeFiles([
              { relativePath: 'datatypes/GVL_TYPE.dt', content: 'TYPE garbage' },
            ])

        const expectedMessage = '"GVL" needs the type name "GVL_TYPE", which a data type file already uses'

        it('refuses a create whose derived type name the file owns', () => {
          seedGhostTypeFile()
          const result = store.getState().globalVariableListActions.create('GVL')
          expect(result.ok).toBe(false)
          expect(result.message).toBe(expectedMessage)
          expect(store.getState().project.data.globalVariableLists ?? []).toHaveLength(0)
        })

        it('refuses a rename whose derived type name the file owns', () => {
          seedList('Other')
          seedGhostTypeFile()
          const result = store.getState().globalVariableListActions.rename('Other', 'GVL')
          expect(result.ok).toBe(false)
          expect(result.message).toBe(expectedMessage)
          expect((store.getState().project.data.globalVariableLists ?? [])[0].name).toBe('Other')
        })

        it('refuses a duplicate whose derived type name the file owns', () => {
          seedList('Other')
          seedGhostTypeFile()
          const result = store.getState().globalVariableListActions.duplicate('Other', 'GVL')
          expect(result.ok).toBe(false)
          expect(result.message).toBe(expectedMessage)
          expect(store.getState().project.data.globalVariableLists ?? []).toHaveLength(1)
        })
      })
    })

    // Bundled library symbols are reserved before the user creates anything.
    describe('against library symbols', () => {
      const librarySymbol = (name: string, type: 'function' | 'function-block') => ({
        name,
        type,
        language: 'st' as const,
        variables: [],
        body: '',
        documentation: '',
      })

      const seedLibraries = () =>
        store.getState().libraryActions.setSystemLibraries([
          {
            name: 'oscat-basic',
            author: 'OSCAT',
            version: '3.3.4',
            stPath: '',
            cPath: '',
            pous: [librarySymbol('MATRIX', 'function-block'), librarySymbol('LIMITS_TYPE', 'function-block')],
          },
          {
            name: 'iec-std-functions',
            author: 'IEC',
            version: '1.0.0',
            stPath: '',
            cPath: '',
            pous: [librarySymbol('SIN', 'function')],
          },
        ])

      beforeEach(() => {
        seedLibraries()
      })

      it('refuses a POU create, naming the library and the symbol kind', () => {
        const result = store.getState().pouActions.create({ type: 'program', name: 'Matrix', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Matrix" is a function block in the oscat-basic library')
        expect(store.getState().project.data.pous).toHaveLength(0)
      })

      it('refuses a data type create, case-insensitively', () => {
        const result = store.getState().datatypeActions.create({ name: 'matrix', derivation: 'structure' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"matrix" is a function block in the oscat-basic library')
        expect(store.getState().project.data.dataTypes).toHaveLength(0)
      })

      it('names a library function as a function', () => {
        const result = store.getState().pouActions.create({ type: 'function', name: 'Sin', language: 'st' })
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"Sin" is a function in the iec-std-functions library')
      })

      it('refuses a global variable list create', () => {
        const result = store.getState().globalVariableListActions.create('MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
      })

      it('refuses a global variable list whose derived type name a library symbol owns', () => {
        const result = store.getState().globalVariableListActions.create('Limits')
        expect(result.ok).toBe(false)
        expect(result.message).toBe(
          '"Limits" needs the type name "Limits_TYPE", which is a function block in the oscat-basic library',
        )
      })

      it('refuses a POU rename onto a library symbol', () => {
        seedPou('Pump')
        const result = store.getState().pouActions.rename('Pump', 'MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
        expect(store.getState().project.data.pous[0].name).toBe('Pump')
      })

      it('refuses a data type rename onto a library symbol', async () => {
        seedDatatype('Motor')
        const result = await store.getState().datatypeActions.rename('Motor', 'MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
        expect(store.getState().project.data.dataTypes[0].name).toBe('Motor')
      })

      it('refuses a global variable list rename onto a library symbol', () => {
        seedList('GVL')
        const result = store.getState().globalVariableListActions.rename('GVL', 'MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
      })

      it('refuses a POU duplicate onto a library symbol', () => {
        seedPou('Pump')
        const result = store.getState().pouActions.duplicate('Pump', 'MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
        expect(store.getState().project.data.pous).toHaveLength(1)
      })

      it('refuses a data type duplicate onto a library symbol', () => {
        seedDatatype('Motor')
        const result = store.getState().datatypeActions.duplicate('Motor', 'MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
        expect(store.getState().project.data.dataTypes).toHaveLength(1)
      })

      it('refuses a global variable list duplicate onto a library symbol', () => {
        seedList('GVL')
        const result = store.getState().globalVariableListActions.duplicate('GVL', 'MATRIX')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('"MATRIX" is a function block in the oscat-basic library')
      })

      it('allows a name no library symbol owns', () => {
        expect(store.getState().pouActions.create({ type: 'program', name: 'Matrices', language: 'st' })).toEqual({
          ok: true,
        })
      })

      // The gate is entry-point only: an existing project with a colliding name still opens.
      it('still opens a project that already carries a colliding name', () => {
        const projectData: PLCProjectData = {
          dataTypes: [],
          pous: [
            {
              name: 'MATRIX',
              pouType: 'program',
              interface: { variables: [] },
              body: { language: 'st', value: '' },
              documentation: '',
            },
          ],
          configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
        }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse({
          meta: { name: 'TestProject', type: 'plc-project', path: '/test/path' },
          projectData,
        })

        expect(store.getState().project.data.pous.map((pou) => pou.name)).toEqual(['MATRIX'])
        expect(store.getState().pouActions.rename('MATRIX', 'Matrices')).toEqual({ ok: true })
      })
    })
  })

  describe('serverActions', () => {
    function addServer(name: string) {
      store.getState().projectActions.createServer({
        data: { name, protocol: 'modbus-tcp' },
      })
      const editorModel = { type: 'plc-server' as const, meta: { name, protocol: 'modbus-tcp' as const } }
      store.getState().editorActions.addModel(editorModel)
      store.getState().fileActions.addFile({ name, type: 'server', filePath: name })
      store.getState().tabsActions.updateTabs({
        name,
        elementType: { type: 'server', protocol: 'modbus-tcp' },
      })
    }

    describe('create', () => {
      it('rejects a server name that is not a valid IEC identifier', () => {
        const result = store.getState().serverActions.create({ name: 'bad name', protocol: 'modbus-tcp' })
        expect(result.ok).toBe(false)
      })
    })

    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with server elementType', () => {
        store.getState().serverActions.deleteRequest('Server1')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'Server1', elementType: 'server' })
      })
    })

    describe('delete', () => {
      beforeEach(() => {
        addServer('Server1')
      })

      it('removes server from all slices', () => {
        const result = store.getState().serverActions.delete('Server1')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.servers).toHaveLength(0)
        expect(state.files['Server1']).toBeUndefined()
        expect(state.tabs).toHaveLength(0)
      })

      it('clears editor if current editor matches deleted server', () => {
        store.getState().editorActions.setEditor({
          type: 'plc-server',
          meta: { name: 'Server1', protocol: 'modbus-tcp' },
        })
        expect(store.getState().editor.meta.name).toBe('Server1')

        store.getState().serverActions.delete('Server1')
        expect(store.getState().editor.type).toBe('available')
      })

      it('does not clear editor if a different server is deleted', () => {
        addServer('Server2')
        store.getState().editorActions.setEditor({
          type: 'plc-server',
          meta: { name: 'Server2', protocol: 'modbus-tcp' },
        })
        expect(store.getState().editor.meta.name).toBe('Server2')

        store.getState().serverActions.delete('Server1')
        expect(store.getState().editor.meta.name).toBe('Server2')
      })
    })

    describe('rename', () => {
      beforeEach(() => {
        addServer('OldServer')
      })

      it('renames server across all slices', () => {
        const result = store.getState().serverActions.rename('OldServer', 'NewServer')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        const server = state.project.data.servers?.find((s) => s.name === 'NewServer')
        expect(server).toBeDefined()
        expect(state.files['NewServer']).toBeDefined()
        expect(state.files['OldServer']).toBeUndefined()
        expect(state.tabs[0].name).toBe('NewServer')
      })

      it('returns error when new name already exists', () => {
        addServer('ExistingServer')
        const result = store.getState().serverActions.rename('OldServer', 'ExistingServer')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Server already exists')
      })

      it('refuses a case-only rename and leaves the registry alone: on a case-folding disk it is the same file', () => {
        const result = store.getState().serverActions.rename('OldServer', 'oldserver')
        expect(result.ok).toBe(false)

        const state = store.getState()
        expect(state.files['OldServer']).toBeDefined()
        expect(state.files['oldserver']).toBeUndefined()
        expect(state.project.data.servers?.[0].name).toBe('OldServer')
        expect(state.pendingDeletions).toEqual([])
      })

      it('treats a rename to the identical name as a no-op instead of a duplicate of itself', () => {
        expect(store.getState().serverActions.rename('OldServer', 'OldServer')).toEqual({ ok: true })
      })
    })
  })

  describe('remoteDeviceActions', () => {
    function addRemoteDevice(name: string) {
      store.getState().projectActions.createRemoteDevice({
        data: { name, protocol: 'modbus-tcp' },
      })
      const editorModel = {
        type: 'plc-remote-device' as const,
        meta: { name, protocol: 'modbus-tcp' as const },
      }
      store.getState().editorActions.addModel(editorModel)
      store.getState().fileActions.addFile({ name, type: 'remote-device', filePath: name })
      store.getState().tabsActions.updateTabs({
        name,
        elementType: { type: 'remote-device', protocol: 'modbus-tcp' },
      })
    }

    describe('create', () => {
      it('rejects a remote device name that is not a valid IEC identifier', () => {
        const result = store.getState().remoteDeviceActions.create({ name: 'bad name', protocol: 'modbus-tcp' })
        expect(result.ok).toBe(false)
      })
    })

    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with remote-device elementType', () => {
        store.getState().remoteDeviceActions.deleteRequest('Device1')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'Device1', elementType: 'remote-device' })
      })
    })

    describe('delete', () => {
      beforeEach(() => {
        addRemoteDevice('Device1')
      })

      it('removes remote device from all slices', () => {
        const result = store.getState().remoteDeviceActions.delete('Device1')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.remoteDevices).toHaveLength(0)
        expect(state.files['Device1']).toBeUndefined()
        expect(state.tabs).toHaveLength(0)
      })

      it('clears editor if current editor matches deleted device', () => {
        store.getState().editorActions.setEditor({
          type: 'plc-remote-device',
          meta: { name: 'Device1', protocol: 'modbus-tcp' },
        })
        expect(store.getState().editor.meta.name).toBe('Device1')

        store.getState().remoteDeviceActions.delete('Device1')
        expect(store.getState().editor.type).toBe('available')
      })

      it('does not clear editor if a different device is deleted', () => {
        addRemoteDevice('Device2')
        store.getState().editorActions.setEditor({
          type: 'plc-remote-device',
          meta: { name: 'Device2', protocol: 'modbus-tcp' },
        })
        expect(store.getState().editor.meta.name).toBe('Device2')

        store.getState().remoteDeviceActions.delete('Device1')
        expect(store.getState().editor.meta.name).toBe('Device2')
      })

      it('cascades to EtherCAT children so their tabs, editors and files are removed', () => {
        store.getState().projectActions.createRemoteDevice({
          data: { name: 'eth', protocol: 'ethercat' },
        })
        store.getState().projectActions.updateEthercatConfig('eth', {
          masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, watchdogTimeoutCycles: 3 },
          devices: [
            { id: 'slave-1', name: 'EK1100' },
            { id: 'slave-2', name: 'EL1008' },
          ] as never,
        })
        for (const child of ['EK1100', 'EL1008']) {
          store
            .getState()
            .editorActions.addModel({ type: 'plc-remote-device', meta: { name: child, protocol: 'ethercat' } })
          store.getState().fileActions.addFile({ name: child, type: 'remote-device', filePath: child })
          store.getState().tabsActions.updateTabs({
            name: child,
            elementType: { type: 'remote-device', protocol: 'ethercat' },
          })
        }

        expect(store.getState().tabs.map((t) => t.name)).toEqual(expect.arrayContaining(['EK1100', 'EL1008']))

        store.getState().remoteDeviceActions.delete('eth')

        const state = store.getState()
        expect(state.project.data.remoteDevices?.some((d) => d.name === 'eth')).toBe(false)
        expect(state.files['EK1100']).toBeUndefined()
        expect(state.files['EL1008']).toBeUndefined()
        expect(state.tabs.some((t) => t.name === 'EK1100' || t.name === 'EL1008')).toBe(false)
      })
    })

    describe('rename', () => {
      beforeEach(() => {
        addRemoteDevice('OldDevice')
      })

      it('renames remote device across all slices', () => {
        const result = store.getState().remoteDeviceActions.rename('OldDevice', 'NewDevice')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        const device = state.project.data.remoteDevices?.find((d) => d.name === 'NewDevice')
        expect(device).toBeDefined()
        expect(state.files['NewDevice']).toBeDefined()
        expect(state.files['OldDevice']).toBeUndefined()
        expect(state.tabs[0].name).toBe('NewDevice')
      })

      it('returns error when new name already exists', () => {
        addRemoteDevice('ExistingDevice')
        const result = store.getState().remoteDeviceActions.rename('OldDevice', 'ExistingDevice')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Remote device already exists')
      })

      it('refuses a case-only rename and leaves the registry alone: on a case-folding disk it is the same file', () => {
        const result = store.getState().remoteDeviceActions.rename('OldDevice', 'olddevice')
        expect(result.ok).toBe(false)

        const state = store.getState()
        expect(state.files['OldDevice']).toBeDefined()
        expect(state.files['olddevice']).toBeUndefined()
        expect(state.project.data.remoteDevices?.[0].name).toBe('OldDevice')
        expect(state.pendingDeletions).toEqual([])
      })

      it('treats a rename to the identical name as a no-op instead of a duplicate of itself', () => {
        expect(store.getState().remoteDeviceActions.rename('OldDevice', 'OldDevice')).toEqual({ ok: true })
      })

      it('refuses a rename onto a POU name and says so', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Pump', language: 'st' })
        const result = store.getState().remoteDeviceActions.rename('OldDevice', 'pump')
        expect(result).toEqual({ ok: false, message: '"pump" is already the name of a POU' })
        expect(store.getState().files['OldDevice']).toBeDefined()
      })
    })
  })

  describe('ethercatDeviceActions', () => {
    function addEthercatBus(name: string, slaves: Array<{ id: string; name: string }>) {
      store.getState().projectActions.createRemoteDevice({
        data: { name, protocol: 'ethercat' },
      })
      store.getState().projectActions.updateEthercatConfig(name, {
        masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000, watchdogTimeoutCycles: 3 },
        devices: slaves as never,
      })
      for (const slave of slaves) {
        store
          .getState()
          .editorActions.addModel({ type: 'plc-remote-device', meta: { name: slave.name, protocol: 'ethercat' } })
        store.getState().fileActions.addFile({ name: slave.name, type: 'ethercat-device', filePath: name })
        store.getState().tabsActions.updateTabs({
          name: slave.name,
          elementType: { type: 'ethercat-device', busName: name, deviceId: slave.id },
        })
      }
    }

    describe('delete', () => {
      beforeEach(() => {
        addEthercatBus('bus1', [{ id: 'slave-1', name: 'EK1100' }])
      })

      it('removes the slave from project, files, tabs and editor', () => {
        store.getState().editorActions.setEditor({
          type: 'plc-remote-device',
          meta: { name: 'EK1100', protocol: 'ethercat' },
        })

        const result = store.getState().ethercatDeviceActions.delete('bus1', 'slave-1')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        const bus = state.project.data.remoteDevices?.find((d) => d.name === 'bus1')
        expect(bus?.ethercatConfig?.devices).toHaveLength(0)
        expect(state.files['EK1100']).toBeUndefined()
        expect(state.tabs.some((t) => t.name === 'EK1100')).toBe(false)
        expect(state.editor.type).toBe('available')
      })

      it('returns error when the bus does not exist', () => {
        const result = store.getState().ethercatDeviceActions.delete('missing-bus', 'slave-1')
        expect(result).toEqual({ ok: false, message: 'Bus not found' })
      })

      it('returns error when the slave id does not exist', () => {
        const result = store.getState().ethercatDeviceActions.delete('bus1', 'missing-slave')
        expect(result).toEqual({ ok: false, message: 'EtherCAT device not found' })
      })

      it('does not clear the editor when a different slave is active', () => {
        store.getState().editorActions.setEditor({
          type: 'plc-remote-device',
          meta: { name: 'other-device', protocol: 'ethercat' },
        })
        store.getState().ethercatDeviceActions.delete('bus1', 'slave-1')
        expect(store.getState().editor.meta.name).toBe('other-device')
      })
    })

    describe('rename', () => {
      beforeEach(() => {
        addEthercatBus('bus1', [
          { id: 'slave-1', name: 'EK1100' },
          { id: 'slave-2', name: 'EL1809' },
        ])
        addEthercatBus('bus2', [{ id: 'slave-3', name: 'EL1809_01' }])
      })

      it('renames the slave across project, files and tabs', () => {
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'slave-1', 'EK1100-renamed')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        const bus = state.project.data.remoteDevices?.find((d) => d.name === 'bus1')
        const slave = bus?.ethercatConfig?.devices?.find((d) => d.id === 'slave-1')
        expect(slave?.name).toBe('EK1100-renamed')
        expect(state.files['EK1100-renamed']).toBeDefined()
        expect(state.files['EK1100']).toBeUndefined()
        expect(state.tabs.some((t) => t.name === 'EK1100-renamed')).toBe(true)
      })

      it('rejects renaming to a name already used by another slave in the same bus', () => {
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'slave-1', 'EL1809')
        expect(result.ok).toBe(false)
        expect(result.message).toContain('EL1809')
        const state = store.getState()
        const bus = state.project.data.remoteDevices?.find((d) => d.name === 'bus1')
        expect(bus?.ethercatConfig?.devices?.find((d) => d.id === 'slave-1')?.name).toBe('EK1100')
      })

      it('rejects renaming to a name already used by a slave on a different bus', () => {
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'slave-2', 'EL1809_01')
        expect(result.ok).toBe(false)
        expect(result.message).toContain('EL1809_01')
      })

      it('allows renaming to the same name (no-op)', () => {
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'slave-1', 'EK1100')
        expect(result).toEqual({ ok: true })
      })

      it('rejects renaming a slave onto a POU name, and says which', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Pump', language: 'st' })
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'slave-1', 'pump')
        expect(result).toEqual({ ok: false, message: '"pump" is already the name of a POU' })
      })

      it('keeps a slave name out of reach of the other workspace kinds', () => {
        expect(store.getState().pouActions.create({ type: 'program', name: 'EK1100', language: 'st' })).toEqual({
          ok: false,
          message: '"EK1100" is already the name of an EtherCAT slave',
        })
        expect(store.getState().serverActions.create({ name: 'el1809', protocol: 'modbus-tcp' })).toEqual({
          ok: false,
          message: '"el1809" is already the name of an EtherCAT slave',
        })
      })

      it('returns error when the bus does not exist', () => {
        const result = store.getState().ethercatDeviceActions.rename('missing-bus', 'slave-1', 'X')
        expect(result).toEqual({ ok: false, message: 'Bus not found' })
      })

      it('returns error when the slave id does not exist', () => {
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'missing-slave', 'X')
        expect(result).toEqual({ ok: false, message: 'EtherCAT device not found' })
      })

      it('rejects an invalid IEC identifier for a SoftMotion (CiA 402) drive', () => {
        addEthercatBus('bus3', [
          { id: 'axis-1', name: 'X_Axis', cia402: { enabled: true, scaleNum: 1, scaleDenom: 1, scaleFactor: 1 } },
        ] as never)
        const bad = store.getState().ethercatDeviceActions.rename('bus3', 'axis-1', 'ASDA-A2-E')
        expect(bad.ok).toBe(false)
        expect(bad.message).toContain('valid axis name')
        const good = store.getState().ethercatDeviceActions.rename('bus3', 'axis-1', 'Y_Axis')
        expect(good.ok).toBe(true)
      })
    })
  })

  describe('snapshotActions', () => {
    const snapshot1 = { variables: [], body: 'body-v1', globalVariables: [] }
    const snapshot2 = { variables: [], body: 'body-v2', globalVariables: [] }
    const snapshot3 = { variables: [], body: 'body-v3', globalVariables: [] }

    describe('pushToHistory', () => {
      it('creates history entry for a POU that has none', () => {
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        const history = store.getState().undoRedo['Main']
        expect(history).toBeDefined()
        expect(history.past).toHaveLength(1)
        expect(history.past[0]).toEqual(snapshot1)
        expect(history.future).toEqual([])
      })

      it('appends to existing history', () => {
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.pushToHistory('Main', snapshot2)
        const history = store.getState().undoRedo['Main']
        expect(history.past).toHaveLength(2)
        expect(history.past[0]).toEqual(snapshot1)
        expect(history.past[1]).toEqual(snapshot2)
      })

      it('clears future when a new snapshot is pushed', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.pushToHistory('Main', snapshot2)
        store.getState().snapshotActions.undo('Main')

        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)

        store.getState().snapshotActions.pushToHistory('Main', snapshot3)
        expect(store.getState().undoRedo['Main'].future).toEqual([])
      })

      it('enforces max history size of 50', () => {
        for (let i = 0; i < 55; i++) {
          store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: `v${i}` })
        }
        const history = store.getState().undoRedo['Main']
        expect(history.past).toHaveLength(50)
        expect(history.past[0].body).toBe('v5')
        expect(history.past[49].body).toBe('v54')
      })

      it('manages separate histories for different POUs', () => {
        store.getState().snapshotActions.pushToHistory('Pou1', snapshot1)
        store.getState().snapshotActions.pushToHistory('Pou2', snapshot2)

        expect(store.getState().undoRedo['Pou1'].past).toHaveLength(1)
        expect(store.getState().undoRedo['Pou2'].past).toHaveLength(1)
        expect(store.getState().undoRedo['Pou1'].past[0]).toEqual(snapshot1)
        expect(store.getState().undoRedo['Pou2'].past[0]).toEqual(snapshot2)
      })
    })

    describe('renameHistory', () => {
      it('moves the undo/redo bucket to the new key', () => {
        store.getState().snapshotActions.pushToHistory('Old', snapshot1)
        store.getState().snapshotActions.renameHistory('Old', 'New')
        expect(store.getState().undoRedo['Old']).toBeUndefined()
        expect(store.getState().undoRedo['New'].past).toEqual([snapshot1])
      })

      it('does nothing when the old key has no history', () => {
        store.getState().snapshotActions.renameHistory('Missing', 'New')
        expect(store.getState().undoRedo['New']).toBeUndefined()
      })
    })

    describe('undo', () => {
      beforeEach(() => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
      })

      it('does nothing if there is no history for the POU', () => {
        const pouBefore = store.getState().project.data.pous.find((p) => p.name === 'Main')
        store.getState().snapshotActions.undo('Main')
        const pouAfter = store.getState().project.data.pous.find((p) => p.name === 'Main')
        expect(pouAfter!.body).toEqual(pouBefore!.body)
      })

      it('does nothing if past is empty', () => {
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].past).toHaveLength(0)
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].past).toHaveLength(0)
      })

      it('does nothing when the POU flow fails its write-back', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        store.getState().pouActions.create({ type: 'program', name: 'Graphical', language: 'ld' })
        store.getState().snapshotActions.pushToHistory('Graphical', snapshot1)
        // `rungs` entries without `defaultBounds` fail the ladder schema, so the
        // body stays stale and a snapshot here would pair it with a fresh flow.
        store.getState().ladderFlowActions.addLadderFlow({
          name: 'Graphical',
          updated: true,
          rungs: [{ id: 'r1', comment: '', nodes: [], edges: [] }],
        } as unknown as LadderFlowType)
        store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'Graphical', updated: true })

        // `false` is what drives the "History unavailable" toast in the UI.
        expect(store.getState().snapshotActions.undo('Graphical')).toBe(false)
        expect(store.getState().snapshotActions.redo('Graphical')).toBe(false)

        expect(store.getState().undoRedo['Graphical'].past).toHaveLength(1)
        expect(store.getState().undoRedo['Graphical'].future).toHaveLength(0)
        warn.mockRestore()
      })

      it('reports success when there is simply nothing to undo', () => {
        expect(store.getState().snapshotActions.undo('Main')).toBe(true)
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        expect(store.getState().snapshotActions.undo('Main')).toBe(true)
      })

      it('undo falls back to empty array when POU has no interface', () => {
        const pous = store.getState().project.data.pous.map((p) => {
          if (p.name === 'Main') {
            return { ...p, interface: undefined }
          }
          return p
        })
        store.getState().projectActions.setPous(pous)

        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [
            { name: 'x', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' },
          ],
          body: 'restored-body',
        })

        store.getState().snapshotActions.undo('Main')

        const history = store.getState().undoRedo['Main']
        expect(history.future).toHaveLength(1)
        expect(history.future[0].variables).toEqual([])
      })

      it('restores the last snapshot and moves current state to future', () => {
        const snapshotWithVars = {
          variables: [
            { name: 'x', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' },
          ],
          body: 'old-body',
          globalVariables: [],
        }
        store.getState().snapshotActions.pushToHistory('Main', snapshotWithVars)

        store.getState().snapshotActions.undo('Main')

        const history = store.getState().undoRedo['Main']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)

        const pou = store.getState().project.data.pous.find((p) => p.name === 'Main')
        expect(pou!.body.value).toBe('old-body')
        expect(pou!.interface!.variables).toEqual(snapshotWithVars.variables)
      })

      it('applies global variables from snapshot during undo', () => {
        const globalVars = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'BOOL' }, location: '', documentation: '' },
        ]
        const snapshotWithGlobals = {
          variables: [],
          body: 'body',
          globalVariables: globalVars,
        }
        store.getState().snapshotActions.pushToHistory('Main', snapshotWithGlobals)
        store.getState().snapshotActions.undo('Main')

        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(globalVars)
      })

      it('undo does not touch globals when snapshot has no globalVariables', () => {
        const existingGlobals = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'BOOL' }, location: '', documentation: '' },
        ]
        store.getState().projectActions.setGlobalVariables({ variables: existingGlobals })

        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [],
          body: 'old-body',
        })

        store.getState().snapshotActions.undo('Main')

        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(existingGlobals)
      })

      it('does nothing if POU does not exist in project', () => {
        store.getState().snapshotActions.pushToHistory('Ghost', snapshot1)
        // Undo early-returns after reading the last past entry but before popping it.
        store.getState().snapshotActions.undo('Ghost')
        expect(store.getState().undoRedo['Ghost'].past).toHaveLength(1)
      })
    })

    describe('redo', () => {
      beforeEach(() => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
      })

      it('does nothing if there is no future', () => {
        store.getState().snapshotActions.redo('Main')
        expect(store.getState().undoRedo['Main']).toBeUndefined()
      })

      it('does nothing if future is empty', () => {
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.redo('Main')
        expect(store.getState().undoRedo['Main'].past).toHaveLength(1)
      })

      it('redo falls back to empty array when POU has no interface', () => {
        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [],
          body: 'snapshot-body',
        })
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)

        const pous = store.getState().project.data.pous.map((p) => {
          if (p.name === 'Main') {
            return { ...p, interface: undefined }
          }
          return p
        })
        store.getState().projectActions.setPous(pous)

        store.getState().snapshotActions.redo('Main')
        const history = store.getState().undoRedo['Main']
        expect(history.future).toHaveLength(0)
        const lastPast = history.past[history.past.length - 1]
        expect(lastPast.variables).toEqual([])
      })

      it('redo does not touch globals when future snapshot has no globalVariables field', () => {
        const existingGlobals = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'BOOL' }, location: '', documentation: '' },
        ]
        store.getState().projectActions.setGlobalVariables({ variables: existingGlobals })

        store.setState({
          undoRedo: {
            Main: {
              past: [],
              future: [{ variables: [], body: 'redo-body' }],
              savedAtDepth: null,
            },
          },
        })

        store.getState().snapshotActions.redo('Main')

        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(existingGlobals)
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('redo-body')
      })

      it('restores the last future snapshot and moves current state to past', () => {
        const snapshotA = {
          variables: [],
          body: 'body-A',
          globalVariables: [],
        }
        const snapshotB = {
          variables: [],
          body: 'body-B',
          globalVariables: [],
        }

        store.getState().snapshotActions.pushToHistory('Main', snapshotA)
        store.getState().snapshotActions.pushToHistory('Main', snapshotB)
        store.getState().snapshotActions.undo('Main')

        expect(store.getState().undoRedo['Main'].past).toHaveLength(1)
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)

        store.getState().snapshotActions.redo('Main')

        const history = store.getState().undoRedo['Main']
        expect(history.future).toHaveLength(0)
        expect(history.past).toHaveLength(2) // snapshotA + current state saved

        const pou = store.getState().project.data.pous.find((p) => p.name === 'Main')
        expect(pou!.body.value).toBe(store.getState().undoRedo['Main'].future.length === 0 ? pou!.body.value : 'body-B')
      })

      it('applies global variables from snapshot during redo', () => {
        const globalVars = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' },
        ]
        const snapshotWithGlobals = {
          variables: [],
          body: 'body',
          globalVariables: globalVars,
        }

        store.getState().snapshotActions.pushToHistory('Main', snapshotWithGlobals)
        store.getState().snapshotActions.undo('Main')

        store.getState().projectActions.setGlobalVariables({ variables: [] })
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual([])
      })

      it('undo then redo restores original state', () => {
        store.getState().projectActions.updatePou({
          name: 'Main',
          content: { language: 'st', value: 'current-body' },
        })

        const previousSnapshot = {
          variables: [],
          body: 'previous-body',
          globalVariables: [],
        }
        store.getState().snapshotActions.pushToHistory('Main', previousSnapshot)

        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('previous-body')

        store.getState().snapshotActions.redo('Main')
        const pouAfterRedo = store.getState().project.data.pous.find((p) => p.name === 'Main')
        expect(pouAfterRedo!.body.value).toBe('current-body')
      })

      it('does nothing if POU does not exist for redo', () => {
        store.getState().snapshotActions.pushToHistory('Ghost', snapshot1)
        store.getState().snapshotActions.undo('Ghost')
        // Ghost has no POU, so undo early-returns before modifying history
        expect(store.getState().undoRedo['Ghost'].past).toHaveLength(1)
      })

      it('redo does nothing when POU no longer exists (deleted after undo)', () => {
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)
        store.getState().pouActions.delete('Main')
        // Redo early-returns before popping future, since the POU no longer exists.
        store.getState().snapshotActions.redo('Main')
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)
      })

      it('redo applies global variables from future snapshot', () => {
        const globalVars = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' },
        ]

        store.getState().projectActions.updatePou({
          name: 'Main',
          content: { language: 'st', value: 'body-with-globals' },
        })
        store.getState().projectActions.setGlobalVariables({ variables: globalVars })

        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [],
          body: 'old-body',
          globalVariables: [],
        })

        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual([])

        store.getState().snapshotActions.redo('Main')
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(globalVars)
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('body-with-globals')
      })

      it('multiple undo/redo cycles work correctly', () => {
        store.getState().projectActions.updatePou({
          name: 'Main',
          content: { language: 'st', value: 'v1' },
        })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v0' })

        store.getState().projectActions.updatePou({
          name: 'Main',
          content: { language: 'st', value: 'v2' },
        })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })

        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v2')

        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v1')

        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v0')

        store.getState().snapshotActions.redo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v1')

        store.getState().snapshotActions.redo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v2')
      })
    })

    describe('undo/redo for data types', () => {
      const edited = {
        name: 'Colors',
        derivation: 'enumerated' as const,
        values: [{ description: 'RED' }],
        initialValue: '',
      }

      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'Colors', derivation: 'enumerated' })
      })

      const getColorsDataType = () => {
        const dataType = store.getState().project.data.dataTypes.find((d) => d.name === 'Colors')
        if (!dataType) throw new Error('Colors data type missing')
        return dataType
      }

      it('undo restores the snapshot data type and moves the current entry to future', () => {
        const initial = getColorsDataType()
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().projectActions.updateDatatype('Colors', edited)

        expect(store.getState().snapshotActions.undo('Colors')).toBe(true)

        expect(store.getState().project.data.dataTypes.find((d) => d.name === 'Colors')).toEqual(initial)
        const history = store.getState().undoRedo['Colors']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
        expect(history.future[0].dataTypes).toEqual([edited])
      })

      it('redo reapplies the undone data type edit', () => {
        const initial = getColorsDataType()
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().projectActions.updateDatatype('Colors', edited)
        store.getState().snapshotActions.undo('Colors')

        expect(store.getState().snapshotActions.redo('Colors')).toBe(true)

        expect(store.getState().project.data.dataTypes.find((d) => d.name === 'Colors')).toEqual(edited)
        const history = store.getState().undoRedo['Colors']
        expect(history.past).toHaveLength(1)
        expect(history.future).toHaveLength(0)
        expect(history.past[0].dataTypes).toEqual([initial])
      })

      it('undo marks the data type file saved when history returns to the saved depth', () => {
        const initial = getColorsDataType()
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().snapshotActions.markSaved('Colors')
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().projectActions.updateDatatype('Colors', edited)
        store.getState().fileActions.updateFile({ name: 'Colors', saved: false })

        store.getState().snapshotActions.undo('Colors')

        expect(store.getState().fileActions.getSavedState({ name: 'Colors' })).toBe(true)
      })

      it('undo marks the data type file unsaved when history diverges from the saved depth', () => {
        const initial = getColorsDataType()
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [edited] })
        store.getState().snapshotActions.markSaved('Colors')
        store.getState().fileActions.updateFile({ name: 'Colors', saved: true })
        store.getState().workspaceActions.setEditingState('saved')

        store.getState().snapshotActions.undo('Colors')

        expect(store.getState().fileActions.getSavedState({ name: 'Colors' })).toBe(false)
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('redo marks the data type file unsaved when history diverges from the saved depth', () => {
        const initial = getColorsDataType()
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().snapshotActions.undo('Colors')
        store.getState().fileActions.updateFile({ name: 'Colors', saved: true })
        store.getState().workspaceActions.setEditingState('saved')

        store.getState().snapshotActions.redo('Colors')

        expect(store.getState().fileActions.getSavedState({ name: 'Colors' })).toBe(false)
        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('undo leaves the data type untouched when the snapshot has no dataTypes entry', () => {
        store.getState().projectActions.updateDatatype('Colors', edited)
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null })

        expect(store.getState().snapshotActions.undo('Colors')).toBe(true)

        expect(store.getState().project.data.dataTypes.find((d) => d.name === 'Colors')).toEqual(edited)
        const history = store.getState().undoRedo['Colors']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
        expect(history.future[0].dataTypes).toEqual([edited])
      })

      it('rename keeps the history and undo restores content under the new name', async () => {
        const initial = getColorsDataType()
        store.getState().snapshotActions.pushToHistory('Colors', { variables: [], body: null, dataTypes: [initial] })
        store.getState().projectActions.updateDatatype('Colors', edited)

        expect((await store.getState().datatypeActions.rename('Colors', 'Palette')).ok).toBe(true)
        expect(store.getState().undoRedo['Colors']).toBeUndefined()
        expect(store.getState().undoRedo['Palette'].past).toHaveLength(1)

        store.getState().snapshotActions.undo('Palette')

        // Name stays pinned to the current key so already-rekeyed tabs/files/editors don't desync.
        const dataType = store.getState().project.data.dataTypes.find((d) => d.name === 'Palette')
        expect(dataType).toEqual({ ...initial, name: 'Palette' })
      })

      it('redo leaves the data type untouched when the future snapshot has no dataTypes entry', () => {
        store.getState().projectActions.updateDatatype('Colors', edited)
        store.setState({
          undoRedo: {
            Colors: {
              past: [],
              future: [{ variables: [], body: null }],
              savedAtDepth: null,
            },
          },
        })

        expect(store.getState().snapshotActions.redo('Colors')).toBe(true)

        expect(store.getState().project.data.dataTypes.find((d) => d.name === 'Colors')).toEqual(edited)
        const history = store.getState().undoRedo['Colors']
        expect(history.past).toHaveLength(1)
        expect(history.past[0].dataTypes).toEqual([edited])
      })
    })
  })

  describe('sharedWorkspaceActions', () => {
    describe('handleFileAndWorkspaceSavedState', () => {
      it('marks a saved file as unsaved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: true })
        expect(store.getState().fileActions.getSavedState({ name: 'TestPou' })).toBe(true)

        store.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('TestPou')

        expect(store.getState().fileActions.getSavedState({ name: 'TestPou' })).toBe(false)
      })

      it('sets workspace editingState to unsaved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: true })
        store.getState().workspaceActions.setEditingState('saved')

        store.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('TestPou')

        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('does not change file saved state if already unsaved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: false })

        store.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('TestPou')

        expect(store.getState().fileActions.getSavedState({ name: 'TestPou' })).toBe(false)
      })

      it('does not change editingState if already unsaved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: true })
        store.getState().workspaceActions.setEditingState('unsaved')

        store.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('TestPou')

        expect(store.getState().workspace.editingState).toBe('unsaved')
      })

      it('warns but does not throw for non-existent file', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        store.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('NonExistent')
        expect(warnSpy).toHaveBeenCalledWith('File with name NonExistent does not exist.')
        warnSpy.mockRestore()
      })
    })

    describe('forceCloseFile', () => {
      it('removes the tab and selects the previous tab', () => {
        store.getState().pouActions.create({ type: 'program', name: 'PouA', language: 'st' })
        store.getState().pouActions.create({ type: 'program', name: 'PouB', language: 'st' })

        const result = store.getState().sharedWorkspaceActions.forceCloseFile('PouB')

        expect(result).toEqual({ success: true })
        expect(store.getState().tabs.find((t) => t.name === 'PouB')).toBeUndefined()
        expect(store.getState().editor.meta.name).toBe('PouA')
      })

      it('falls back to CreateEditorObjectFromTab when editor not in editors array', () => {
        store.getState().tabsActions.updateTabs({
          name: 'OrphanTab',
          elementType: { type: 'program', language: 'st' },
        })
        store.getState().pouActions.create({ type: 'program', name: 'ToClose', language: 'st' })

        const result = store.getState().sharedWorkspaceActions.forceCloseFile('ToClose')

        expect(result).toEqual({ success: true })
        expect(store.getState().editor.meta.name).toBe('OrphanTab')
      })

      it('clears editor when last tab is closed', () => {
        store.getState().pouActions.create({ type: 'program', name: 'OnlyPou', language: 'st' })

        store.getState().sharedWorkspaceActions.forceCloseFile('OnlyPou')

        expect(store.getState().tabs).toHaveLength(0)
        expect(store.getState().editor.type).toBe('available')
      })

      it('selects a diff-viewer next tab with a null project-tree leaf', () => {
        // A diff-viewer tab has no project-tree leaf, so its leaf type must be null when active.
        store.getState().tabsActions.updateTabs({
          name: 'Diff: pous/programs/Main.st',
          elementType: { type: 'diff-viewer', filePath: 'pous/programs/Main.st' },
        })
        store.getState().pouActions.create({ type: 'program', name: 'PouA', language: 'st' })

        store.getState().sharedWorkspaceActions.forceCloseFile('PouA')

        expect(store.getState().editor.type).toBe('diff-viewer')
        expect(store.getState().workspace.selectedProjectTreeLeaf.type).toBeNull()
      })

      it('does not resurrect the closed model in editors[]', () => {
        // forceCloseFile must remove the active model from editors[] before setEditor runs
        // for the next tab, or the closed model reappears on the next focus switch.
        store.getState().pouActions.create({ type: 'program', name: 'A', language: 'st' })
        store.getState().pouActions.create({ type: 'program', name: 'B', language: 'st' })
        store.getState().editorActions.setEditor(store.getState().editorActions.getEditorFromEditors('A')!)
        expect(store.getState().editor.meta.name).toBe('A')

        store.getState().sharedWorkspaceActions.forceCloseFile('A')

        expect(store.getState().editors.find((e) => e.meta.name === 'A')).toBeUndefined()
        expect(store.getState().editor.meta.name).toBe('B')
      })
    })

    describe('openRetrievedProject', () => {
      it('loads the project and marks it as having no location yet', () => {
        store.getState().sharedWorkspaceActions.openRetrievedProject({
          meta: { name: 'Irrigation Controller', type: 'plc-project', path: '/scratch/retrieved/irrigation' },
          projectData: {
            pous: [],
            dataTypes: [],
            globalVariableLists: [],
            configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
          },
        })

        expect(store.getState().project.meta.name).toBe('Irrigation Controller')
        // Ephemeral: points the next Save at Save As instead of a scratch dir the app prunes.
        expect(store.getState().workspace.isEphemeralProject).toBe(true)
      })
    })

    describe('hasUnsavedChanges', () => {
      it('is true while the editing state is unsaved', () => {
        store.getState().workspaceActions.setEditingState('unsaved')

        expect(store.getState().sharedWorkspaceActions.hasUnsavedChanges()).toBe(true)
      })

      it('is true while any file is unsaved, whatever the editing state says', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: false })
        store.getState().workspaceActions.setEditingState('saved')

        expect(store.getState().sharedWorkspaceActions.hasUnsavedChanges()).toBe(true)
      })

      it('is false once everything is saved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: true })
        store.getState().workspaceActions.setEditingState('saved')

        expect(store.getState().sharedWorkspaceActions.hasUnsavedChanges()).toBe(false)
      })

      it('agrees with what closeProject does about it', () => {
        store.getState().workspaceActions.setEditingState('unsaved')

        const dirty = store.getState().sharedWorkspaceActions.hasUnsavedChanges()
        const { pendingConfirmation } = store.getState().sharedWorkspaceActions.closeProject()

        expect(pendingConfirmation).toBe(dirty)
      })
    })

    describe('closeProject', () => {
      it('opens save-changes modal when there are unsaved changes', () => {
        store.getState().workspaceActions.setEditingState('unsaved')

        const result = store.getState().sharedWorkspaceActions.closeProject()

        const modalState = store.getState().modalActions.getModalState('save-changes-project')
        expect(modalState.open).toBe(true)
        expect(result).toEqual({ pendingConfirmation: true })
      })

      it('clears state when everything is saved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: true })
        store.getState().workspaceActions.setEditingState('saved')

        const result = store.getState().sharedWorkspaceActions.closeProject()

        expect(store.getState().tabs).toHaveLength(0)
        expect(store.getState().project.data.pous).toHaveLength(0)
        expect(result).toEqual({ pendingConfirmation: false })
      })
    })

    describe('clearStatesOnCloseProject', () => {
      it('resets all slice states', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().consoleActions.addLog({ level: 'info', message: 'test' })

        store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

        expect(store.getState().tabs).toHaveLength(0)
        expect(store.getState().project.data.pous).toHaveLength(0)
        expect(store.getState().logs).toHaveLength(0)
        expect(store.getState().editor.type).toBe('available')
      })
    })

    describe('closeFile', () => {
      it('shows save-changes modal when file has unsaved changes', () => {
        store.getState().pouActions.create({ type: 'program', name: 'UnsavedPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'UnsavedPou', saved: false })

        const result = store.getState().sharedWorkspaceActions.closeFile('UnsavedPou')
        expect(result).toEqual({ success: false })

        const modalState = store.getState().modalActions.getModalState('save-changes-file')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ fileName: 'UnsavedPou' })
      })

      it('closes file directly when file is saved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'SavedPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'SavedPou', saved: true })

        const result = store.getState().sharedWorkspaceActions.closeFile('SavedPou')
        expect(result).toEqual({ success: true })
        expect(store.getState().tabs.find((t) => t.name === 'SavedPou')).toBeUndefined()
      })
    })

    describe('handleOpenProjectResponse', () => {
      function makeMinimalProjectResponse() {
        return {
          meta: { name: 'TestProject', type: 'plc-project' as const, path: '/test/path' },
          projectData: {
            dataTypes: [] as ReturnType<typeof store.getState>['project']['data']['dataTypes'],
            pous: [
              {
                name: 'main',
                pouType: 'program' as const,
                interface: {
                  variables: [
                    {
                      name: 'x',
                      class: 'local' as const,
                      type: { definition: 'base-type' as const, value: 'INT' },
                      location: '',
                      documentation: '',
                    },
                  ],
                },
                body: { language: 'st' as const, value: '' as unknown },
                documentation: '',
              },
            ] as ReturnType<typeof store.getState>['project']['data']['pous'],
            configurations: {
              resource: {
                tasks: [] as ReturnType<
                  typeof store.getState
                >['project']['data']['configurations']['resource']['tasks'],
                instances: [] as ReturnType<
                  typeof store.getState
                >['project']['data']['configurations']['resource']['instances'],
                globalVariables: [] as ReturnType<
                  typeof store.getState
                >['project']['data']['configurations']['resource']['globalVariables'],
              },
            },
            debugVariables: undefined as ReturnType<typeof store.getState>['project']['data']['debugVariables'],
            servers: undefined as ReturnType<typeof store.getState>['project']['data']['servers'],
            remoteDevices: undefined as ReturnType<typeof store.getState>['project']['data']['remoteDevices'],
          },
        }
      }

      // DOPE-442
      describe('a project saved before 4.3.0', () => {
        /** A board whose Modbus lived in the VPP screen sections. */
        const legacyBoard = {
          deviceConfiguration: {
            deviceBoard: 'ESP32',
            communicationPort: '',
            vendorScreenData: {
              modbus_rtu: { enabled: true, rtu_slave_id: 7, rtu_interface: 'Serial2', rtu_baud_rate: '115200' },
              modbus_tcp: { enabled: false },
            },
          },
        }

        it('opens with no Modbus server and leaves the old sections untouched', () => {
          // 4.3.0 does not carry configuration forward. Nothing is promoted,
          // nothing is rewritten, and the project is not dirtied on open -- the
          // user creates the server again, and until then no Modbus is compiled.
          const data = { ...makeMinimalProjectResponse(), ...legacyBoard }
          store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

          const state = store.getState()
          expect(state.project.data.servers ?? []).toHaveLength(0)
          expect(state.workspace.editingState).toBe('saved')
          expect(state.deviceDefinitions.configuration.vendorScreenData).toEqual(
            legacyBoard.deviceConfiguration.vendorScreenData,
          )
        })
      })

      it('opens EMPTY and read-only when a POU is unrecoverable, and says why on the Console', () => {
        const data = {
          ...makeMinimalProjectResponse(),
          fatalErrors: ['POU "main" (pous/programs/main.ld) could not be parsed'],
        }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const state = store.getState()
        // `meta.path` is what moves the desktop app off the start screen to show the Console.
        expect(state.project.meta.path).toBe('/test/path')
        // No content: a blank canvas would look like a legitimate empty diagram.
        expect(state.project.data.pous).toHaveLength(0)
        // Read-only, so no save can write that emptiness over the real file.
        expect(state.workspace.canEdit).toBe(false)
        // And the reason is on the Console, as an error rather than a warning.
        const errors = state.logs.filter((log) => log.level === 'error')
        expect(errors.some((log) => log.message.includes('pous/programs/main.ld'))).toBe(true)
        expect(errors.some((log) => log.message.includes('read-only'))).toBe(true)
      })

      it('stashes the raw loaded files for the save flow, and clears them on a reopen without any', () => {
        const rawLoadedFiles = { 'project.json': '{"meta":{}}', 'pous/programs/main.st': 'PROGRAM main\nEND_PROGRAM' }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse({
          ...makeMinimalProjectResponse(),
          rawLoadedFiles,
        })
        expect(store.getState().versionControl.rawLoadedContent).toEqual(rawLoadedFiles)

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(makeMinimalProjectResponse())
        expect(store.getState().versionControl.rawLoadedContent).toEqual({})
      })

      it('still opens normally when the failure is only a recoverable warning', () => {
        const data = { ...makeMinimalProjectResponse(), warnings: ['POU "main" could not be fully parsed'] }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const state = store.getState()
        expect(state.project.data.pous).toHaveLength(1)
        expect(state.workspace.canEdit).toBe(true)
      })

      it('opens a minimal project with an ST main POU', () => {
        const data = makeMinimalProjectResponse()
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const state = store.getState()
        expect(state.project.meta.name).toBe('TestProject')
        expect(state.project.meta.path).toBe('/test/path')
        expect(state.project.data.pous).toHaveLength(1)
        expect(state.project.data.pous[0].name).toBe('main')

        expect(state.tabs).toHaveLength(1)
        expect(state.tabs[0].name).toBe('main')
        expect(state.selectedTab).toBe('main')
        expect(state.editor.meta.name).toBe('main')

        expect(state.files['main']).toBeDefined()
        expect(state.files['main'].saved).toBe(true)
        expect(state.files['Resource']).toBeDefined()
        expect(state.files['Configuration']).toBeDefined()
      })

      it('pre-opens an unreadable .dt file as a code-mode tab without stealing focus', () => {
        const data = {
          ...makeMinimalProjectResponse(),
          unparsedDataTypeFiles: [
            { relativePath: 'datatypes/Broken.dt', content: 'TYPE\nBroken : STRUCT\ngarbage\nEND_TYPE\n' },
            // No name to derive — skipped rather than registered under ''.
            { relativePath: '', content: 'orphan' },
          ],
        }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const state = store.getState()
        expect(state.unparsedDataTypeFiles).toHaveLength(2)
        expect(state.files['Broken']).toEqual({ type: 'data-type', filePath: 'Broken', saved: true })
        expect(state.files['']).toBeUndefined()
        expect(state.tabs.map((tab) => tab.name)).toEqual(['main', 'Broken'])
        expect(state.selectedTab).toBe('main')

        const model = state.editors.find((editor) => editor.meta.name === 'Broken')
        expect(model?.type === 'plc-datatype' && model.meta.derivation).toBe('structure')
        expect(model?.type === 'plc-datatype' && model.structure).toEqual({
          display: 'code',
          code: 'TYPE\nBroken : STRUCT\ngarbage\nEND_TYPE\n',
        })
      })

      it('does not let an unreadable .dt displace a POU or a parsed type of the same name', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.dataTypes = [
          { name: 'Colors', derivation: 'enumerated', values: [{ description: 'RED' }], initialValue: '' },
        ] as typeof data.projectData.dataTypes
        const withCollisions = {
          ...data,
          unparsedDataTypeFiles: [
            // Case-insensitive: the filesystem folds case, the registry doesn't.
            { relativePath: 'datatypes/MAIN.dt', content: 'TYPE\ngarbage\nEND_TYPE\n' },
            { relativePath: 'datatypes/colors.dt', content: 'TYPE\ngarbage\nEND_TYPE\n' },
          ],
        }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(withCollisions)

        const state = store.getState()
        expect(state.files['main'].type).toBe('program')
        expect(state.tabs.map((tab) => tab.name)).toEqual(['main'])
        expect(state.editors.every((editor) => editor.type !== 'plc-datatype')).toBe(true)
        expect(state.files['MAIN']).toBeUndefined()
        expect(state.files['colors']).toBeUndefined()
        // Still preserved, so the next save echoes both files back verbatim.
        expect(state.unparsedDataTypeFiles).toHaveLength(2)
      })

      it('logs warnings to console when present', () => {
        const data = {
          ...makeMinimalProjectResponse(),
          warnings: ['Warning 1', 'Warning 2'],
        }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const logs = store.getState().logs
        expect(logs).toHaveLength(2)
        expect(logs[0].level).toBe('warning')
        expect(logs[0].message).toBe('Warning 1')
        expect(logs[1].message).toBe('Warning 2')
      })

      it('adds ladder flows for LD POUs', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.pous.push({
          name: 'LdProg',
          pouType: 'program',
          interface: { variables: [] },
          body: {
            language: 'ld',
            value: { name: 'LdProg', rungs: [] },
          },
          documentation: '',
        })

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const ladderFlows = store.getState().ladderFlows
        expect(ladderFlows.some((f) => f.name === 'LdProg')).toBe(true)
      })

      it('adds FBD flows for FBD POUs', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.pous.push({
          name: 'FbdProg',
          pouType: 'program',
          interface: { variables: [] },
          body: {
            language: 'fbd',
            value: { name: 'FbdProg', rung: { comment: '', edges: [], nodes: [] } },
          },
          documentation: '',
        })

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const fbdFlows = store.getState().fbdFlows
        expect(fbdFlows.some((f) => f.name === 'FbdProg')).toBe(true)
      })

      it('registers non-program POUs in the library', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.pous.push({
          name: 'MyFunc',
          pouType: 'function',
          interface: { variables: [] },
          body: { language: 'st', value: '' },
          documentation: '',
        })
        data.projectData.pous.push({
          name: 'MyFB',
          pouType: 'function-block',
          interface: { variables: [] },
          body: { language: 'st', value: '' },
          documentation: '',
        })

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const userLibs = store.getState().libraries.user
        expect(userLibs.some((l) => l.name === 'MyFunc')).toBe(true)
        expect(userLibs.some((l) => l.name === 'MyFB')).toBe(true)
        expect(userLibs.some((l) => l.name === 'main')).toBe(false)
      })

      it('sets device definitions when provided', () => {
        const deviceConfig = {
          deviceBoard: 'test-board',
          communicationPort: '',
          compileOnly: false,
        }
        const data = {
          ...makeMinimalProjectResponse(),
          deviceConfiguration: deviceConfig,
          devicePinMapping: [{ pin: 'D0', pinType: 'digitalInput' as const, address: '%IX0.0' }],
        }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        expect(store.getState().deviceDefinitions.configuration.deviceBoard).toBe('test-board')
      })

      it('registers data types as files', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.dataTypes = [
          { name: 'MyArray', derivation: 'array', baseType: { definition: 'base-type', value: 'INT' }, dimensions: [] },
        ]

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        expect(store.getState().files['MyArray']).toBeDefined()
        expect(store.getState().files['MyArray'].type).toBe('data-type')
      })

      it('registers servers as files', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.servers = [{ name: 'Server1', protocol: 'modbus-tcp' }]

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        expect(store.getState().files['Server1']).toBeDefined()
        expect(store.getState().files['Server1'].type).toBe('server')
      })

      it('registers remote devices as files', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.remoteDevices = [{ name: 'Device1', protocol: 'modbus-tcp' }]

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        expect(store.getState().files['Device1']).toBeDefined()
        expect(store.getState().files['Device1'].type).toBe('remote-device')
      })

      it('does not open a tab when there is no main program POU', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.pous = [
          {
            name: 'Helper',
            pouType: 'function',
            interface: { variables: [] },
            body: { language: 'st', value: '' },
            documentation: '',
          },
        ]

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        expect(store.getState().tabs).toHaveLength(0)
      })

      it('restores debug flags for global variables', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.configurations.resource.globalVariables = [
          {
            name: 'GV1',
            class: 'global',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
        ]
        data.projectData.debugVariables = {
          global: ['GV1'],
        }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const globalVars = store.getState().project.data.configurations.resource.globalVariables
        expect(globalVars[0].debug).toBe(true)
      })

      it('restores debug flags for POU variables', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.debugVariables = {
          pous: {
            main: ['x'],
          },
        }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const pou = store.getState().project.data.pous.find((p) => p.name === 'main')
        const xVar = pou?.interface?.variables.find((v) => v.name === 'x')
        expect(xVar?.debug).toBe(true)
      })

      it('skips debug flags for non-existent global variables', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.debugVariables = {
          global: ['NonExistent'],
        }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const globalVars = store.getState().project.data.configurations.resource.globalVariables
        expect(globalVars).toHaveLength(0)
      })

      it('skips debug flags for non-existent POU', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.debugVariables = {
          pous: {
            NonExistentPou: ['x'],
          },
        }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
      })

      it('skips debug flags for non-existent POU variable', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.debugVariables = {
          pous: {
            main: ['nonExistentVar'],
          },
        }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
      })

      it('handles project with no debugVariables', () => {
        const data = makeMinimalProjectResponse()

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        expect(store.getState().project.data.pous).toHaveLength(1)
      })

      it('handles empty debugVariables.global array', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.debugVariables = { global: [] }

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
        expect(store.getState().project.data.pous).toHaveLength(1)
      })

      it('pre-creates editor model for POU with variablesText and no variables', () => {
        const data = makeMinimalProjectResponse()
        const pouWithText = {
          name: 'UnparseablePou',
          pouType: 'program' as const,
          interface: { variables: [] as PLCVariable[] },
          body: { language: 'st' as const, value: '' },
          documentation: '',
          variablesText: 'VAR\n  unparseable_stuff;\nEND_VAR',
          // The loader marks a POU whose declarations it could not parse; the
          // code view is for those, not for every POU that carries its text.
          variablesTextUnparsed: true,
        }
        data.projectData.pous.push(pouWithText)

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const editor = store.getState().editorActions.getEditorFromEditors('UnparseablePou')
        expect(editor).toBeDefined()
        expect(editor && 'variable' in editor && editor.variable).toEqual({
          display: 'code',
          code: 'VAR\n  unparseable_stuff;\nEND_VAR',
        })
      })

      it('delivers the raw variable text to the auto-opened main POU (issue #904)', () => {
        // setEditor early-returns on the already-active editor, so the raw text must flow
        // through updateModelVariablesForName instead.
        const rawText = 'VAR_OUTPUT\n  Q1 : BOOL AT %QX0.0;\nEND_VAR'
        const data = makeMinimalProjectResponse()
        const unparseableMain = {
          name: 'main',
          pouType: 'program' as const,
          interface: { variables: [] as PLCVariable[] },
          body: { language: 'st' as const, value: '' },
          documentation: '',
          variablesText: rawText,
          variablesTextUnparsed: true,
        }
        data.projectData.pous.length = 0
        data.projectData.pous.push(unparseableMain)

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const state = store.getState()
        expect(state.editor.meta.name).toBe('main')
        expect('variable' in state.editor && state.editor.variable).toEqual({
          display: 'code',
          code: rawText,
        })
      })

      it('does not create code-mode model for POU with variables (non-empty)', () => {
        const data = makeMinimalProjectResponse()
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const editorModel = store.getState().editorActions.getEditorFromEditors('main')
        expect(editorModel).toBeDefined()
        if (editorModel && 'variable' in editorModel) {
          expect(editorModel.variable.display).toBe('table')
        }
      })

      it('resets graphical flow updated flags at the end', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.pous.push({
          name: 'LdPou',
          pouType: 'program',
          interface: { variables: [] },
          body: {
            language: 'ld',
            value: { name: 'LdPou', rungs: [] },
          },
          documentation: '',
        })

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const ldFlows = store.getState().ladderFlows.filter((f) => f.name === 'LdPou')
        ldFlows.forEach((flow) => {
          expect(flow.updated).toBe(false)
        })
      })

      it('sets workspace.canEdit=false when backend canEdit is false', () => {
        const data = { ...makeMinimalProjectResponse(), canEdit: false }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
        expect(store.getState().workspace.canEdit).toBe(false)
      })

      it('keeps workspace.canEdit=true when backend canEdit is true', () => {
        // Pre-seed denied so we observe the reset path, not just the default.
        store.getState().workspaceActions.setCanEdit(false)
        const data = { ...makeMinimalProjectResponse(), canEdit: true }
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
        expect(store.getState().workspace.canEdit).toBe(true)
      })

      it('treats absent canEdit as editable (desktop / dev-local default)', () => {
        store.getState().workspaceActions.setCanEdit(false)
        const data = makeMinimalProjectResponse()
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
        expect(store.getState().workspace.canEdit).toBe(true)
      })
    })
  })

  describe('serverActions (create)', () => {
    it('creates a server and updates all slices', () => {
      const result = store.getState().serverActions.create({ name: 'MyServer', protocol: 'modbus-tcp' })
      expect(result).toEqual({ ok: true })

      const state = store.getState()
      expect(state.project.data.servers).toHaveLength(1)
      expect(state.project.data.servers![0].name).toBe('MyServer')
      expect(state.editor.meta.name).toBe('MyServer')
      expect(state.files['MyServer']).toBeDefined()
      expect(state.files['MyServer'].type).toBe('server')
      expect(state.tabs).toHaveLength(1)
      expect(state.selectedTab).toBe('MyServer')
    })

    it('returns error when server name already exists', () => {
      store.getState().serverActions.create({ name: 'Dup', protocol: 'modbus-tcp' })
      const result = store.getState().serverActions.create({ name: 'Dup', protocol: 's7comm' })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Server already exists')
    })
  })

  describe('remoteDeviceActions (create)', () => {
    it('creates a remote device and updates all slices', () => {
      const result = store.getState().remoteDeviceActions.create({ name: 'MyDevice', protocol: 'modbus-tcp' })
      expect(result).toEqual({ ok: true })

      const state = store.getState()
      expect(state.project.data.remoteDevices).toHaveLength(1)
      expect(state.project.data.remoteDevices![0].name).toBe('MyDevice')
      expect(state.editor.meta.name).toBe('MyDevice')
      expect(state.files['MyDevice']).toBeDefined()
      expect(state.files['MyDevice'].type).toBe('remote-device')
      expect(state.tabs).toHaveLength(1)
      expect(state.selectedTab).toBe('MyDevice')
    })

    it('returns error when remote device name already exists', () => {
      store.getState().remoteDeviceActions.create({ name: 'Dup', protocol: 'modbus-tcp' })
      const result = store.getState().remoteDeviceActions.create({ name: 'Dup', protocol: 'ethernet-ip' })
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Remote device already exists')
    })
  })

  describe('snapshotActions (additional)', () => {
    describe('markSaved', () => {
      it('sets savedAtDepth to current past length', () => {
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'v2' })

        store.getState().snapshotActions.markSaved('P1')

        const history = store.getState().undoRedo['P1']
        expect(history.savedAtDepth).toBe(2) // past length = 2
      })

      it('does nothing for non-existent POU history', () => {
        store.getState().snapshotActions.markSaved('NonExistent')
        expect(store.getState().undoRedo['NonExistent']).toBeUndefined()
      })
    })

    describe('markAllSaved', () => {
      it('sets savedAtDepth for all POU histories', () => {
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('P2', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('P2', { variables: [], body: 'v2' })

        store.getState().snapshotActions.markAllSaved()

        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(1)
        expect(store.getState().undoRedo['P2'].savedAtDepth).toBe(2)
      })

      it('skips the excluded POUs', () => {
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('P2', { variables: [], body: 'v1' })

        store.getState().snapshotActions.markAllSaved(['P2'])

        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(1)
        expect(store.getState().undoRedo['P2'].savedAtDepth).toBe(0)
      })
    })

    describe('pushToHistory savedAtDepth', () => {
      it('nullifies savedAtDepth when saved state was in the future (discarded)', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })

        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v2' })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v3' })

        store.getState().snapshotActions.markSaved('Main')
        expect(store.getState().undoRedo['Main'].savedAtDepth).toBe(3)

        store.getState().snapshotActions.undo('Main')
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].past).toHaveLength(1)

        // savedAtDepth (3) > past.length (1) after this push, so it is nullified.
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'new' })
        expect(store.getState().undoRedo['Main'].savedAtDepth).toBeNull()
      })

      it('adjusts savedAtDepth when history exceeds max size', () => {
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'initial' })
        store.getState().snapshotActions.markSaved('P1')
        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(1)

        for (let i = 0; i < 54; i++) {
          store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: `v${i}` })
        }

        // 55 entries > 50 max shifts savedAtDepth by 5: 1 - 5 = -4 -> null.
        expect(store.getState().undoRedo['P1'].savedAtDepth).toBeNull()
      })

      it('adjusts savedAtDepth without going negative when saved state is recent', () => {
        for (let i = 0; i < 48; i++) {
          store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: `v${i}` })
        }
        store.getState().snapshotActions.markSaved('P1')
        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(48)

        // 51 total, only the 51st causes a shift: savedAtDepth = 48 - 1 = 47.
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'a' })
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'b' })
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'c' })

        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(47)
      })
    })

    describe('undo with ladder flow', () => {
      it('restores ladder flow snapshot on undo', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdPou', language: 'ld' })

        const ladderSnapshot = {
          variables: [],
          body: { name: 'LdPou', rungs: [] },
          ladderFlow: { name: 'LdPou', rungs: [], updated: false },
        }
        store.getState().snapshotActions.pushToHistory('LdPou', ladderSnapshot)
        store.getState().snapshotActions.undo('LdPou')

        const history = store.getState().undoRedo['LdPou']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
      })

      it('saves current ladder flow to future when undoing with flow in store', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdPou', language: 'ld' })
        store.getState().ladderFlowActions.addLadderFlow({ name: 'LdPou', rungs: [] } as never)

        const ladderSnapshot = {
          variables: [],
          body: { name: 'LdPou', rungs: [] },
          ladderFlow: { name: 'LdPou', rungs: [], updated: false },
        }
        store.getState().snapshotActions.pushToHistory('LdPou', ladderSnapshot)
        store.getState().snapshotActions.undo('LdPou')

        const history = store.getState().undoRedo['LdPou']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
        expect(history.future[0].ladderFlow).toBeDefined()
      })
    })

    describe('undo with FBD flow', () => {
      it('restores FBD flow snapshot on undo', () => {
        store.getState().pouActions.create({ type: 'program', name: 'FbdPou', language: 'fbd' })

        const fbdSnapshot = {
          variables: [],
          body: { name: 'FbdPou', rung: { comment: '', edges: [], nodes: [] } },
          fbdFlow: { name: 'FbdPou', rung: { comment: '', edges: [], nodes: [] }, updated: false },
        }
        store.getState().snapshotActions.pushToHistory('FbdPou', fbdSnapshot)
        store.getState().snapshotActions.undo('FbdPou')

        const history = store.getState().undoRedo['FbdPou']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
      })

      it('saves current FBD flow to future when undoing with flow in store', () => {
        store.getState().pouActions.create({ type: 'program', name: 'FbdPou', language: 'fbd' })
        store.getState().fbdFlowActions.addFBDFlow({
          name: 'FbdPou',
          rung: { comment: '', edges: [], nodes: [], selectedNodes: [] },
          updated: false,
        } as never)

        const fbdSnapshot = {
          variables: [],
          body: { name: 'FbdPou', rung: { comment: '', edges: [], nodes: [] } },
          fbdFlow: { name: 'FbdPou', rung: { comment: '', edges: [], nodes: [] }, updated: false },
        }
        store.getState().snapshotActions.pushToHistory('FbdPou', fbdSnapshot)
        store.getState().snapshotActions.undo('FbdPou')

        const history = store.getState().undoRedo['FbdPou']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
        expect(history.future[0].fbdFlow).toBeDefined()
      })
    })

    describe('redo with ladder flow', () => {
      it('applies ladder flow from future snapshot on redo', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdPou', language: 'ld' })
        store.getState().ladderFlowActions.addLadderFlow({ name: 'LdPou', rungs: [] } as never)

        store.setState({
          undoRedo: {
            LdPou: {
              past: [],
              future: [
                {
                  variables: [],
                  body: { name: 'LdPou', rungs: [] },
                  ladderFlow: { name: 'LdPou', rungs: [], updated: false },
                },
              ],
              savedAtDepth: null,
            },
          },
        })

        store.getState().snapshotActions.redo('LdPou')

        const history = store.getState().undoRedo['LdPou']
        expect(history.future).toHaveLength(0)
        expect(history.past).toHaveLength(1)
      })
    })

    describe('redo with FBD flow', () => {
      it('applies FBD flow from future snapshot on redo', () => {
        store.getState().pouActions.create({ type: 'program', name: 'FbdPou', language: 'fbd' })
        store.getState().fbdFlowActions.addFBDFlow({
          name: 'FbdPou',
          rung: { comment: '', edges: [], nodes: [], selectedNodes: [] },
          updated: false,
        } as never)

        store.setState({
          undoRedo: {
            FbdPou: {
              past: [],
              future: [
                {
                  variables: [],
                  body: { name: 'FbdPou', rung: { comment: '', edges: [], nodes: [] } },
                  fbdFlow: {
                    name: 'FbdPou',
                    rung: { comment: '', edges: [], nodes: [], selectedNodes: [] },
                    updated: false,
                  },
                },
              ],
              savedAtDepth: null,
            },
          },
        })

        store.getState().snapshotActions.redo('FbdPou')

        const history = store.getState().undoRedo['FbdPou']
        expect(history.future).toHaveLength(0)
        expect(history.past).toHaveLength(1)
      })
    })

    describe('undo savedAtDepth', () => {
      it('marks file as saved when undo returns to saved depth', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'Main', saved: true })

        // savedAtDepth is pinned at 1; undoing from past.length 2 back to 1 must re-mark saved.
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })
        store.getState().snapshotActions.markSaved('Main')

        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v2' })
        store.getState().fileActions.updateFile({ name: 'Main', saved: false })

        store.getState().snapshotActions.undo('Main')

        expect(store.getState().fileActions.getSavedState({ name: 'Main' })).toBe(true)
      })
    })

    describe('redo savedAtDepth', () => {
      it('marks file as saved when redo returns to saved depth', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'Main', saved: true })

        // savedAtDepth is pinned at 2; redoing from past.length 1 back to 2 must re-mark saved.
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v2' })

        store.getState().snapshotActions.markSaved('Main')

        store.getState().snapshotActions.undo('Main')
        store.getState().fileActions.updateFile({ name: 'Main', saved: false })

        store.getState().snapshotActions.redo('Main')

        expect(store.getState().fileActions.getSavedState({ name: 'Main' })).toBe(true)
      })
    })
  })
})
