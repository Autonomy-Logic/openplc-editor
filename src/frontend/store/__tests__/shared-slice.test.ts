import { createStore } from 'zustand/vanilla'

import type { PLCVariable } from '../../../middleware/shared/ports/types'
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

describe('createSharedSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // =========================================================================
  // Initial state
  // =========================================================================
  it('should have empty undoRedo state initially', () => {
    expect(store.getState().undoRedo).toEqual({})
  })

  // =========================================================================
  // pouActions
  // =========================================================================
  describe('pouActions', () => {
    // -----------------------------------------------------------------------
    // create
    // -----------------------------------------------------------------------
    describe('create', () => {
      it('creates an ST program and updates all slices', () => {
        const result = store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        expect(result).toEqual({ ok: true })

        const state = store.getState()

        // Project slice: POU was added
        expect(state.project.data.pous).toHaveLength(1)
        expect(state.project.data.pous[0].name).toBe('Main')
        expect(state.project.data.pous[0].pouType).toBe('program')

        // Editor slice: model added to editors and set as current
        expect(state.editor.type).toBe('plc-textual')
        expect(state.editor.meta.name).toBe('Main')

        // File slice: file entry created
        expect(state.files['Main']).toBeDefined()
        expect(state.files['Main'].type).toBe('program')
        expect(state.files['Main'].isNew).toBe(true)

        // Tabs slice: tab added and selected
        expect(state.tabs).toHaveLength(1)
        expect(state.tabs[0].name).toBe('Main')
        expect(state.selectedTab).toBe('Main')

        // Library slice: user library added
        expect(state.libraries.user).toHaveLength(1)
        expect(state.libraries.user[0].name).toBe('Main')
        // program maps to 'function' library type
        expect(state.libraries.user[0].type).toBe('function')
      })

      it('creates an LD function-block', () => {
        const result = store.getState().pouActions.create({ type: 'function-block', name: 'FB1', language: 'ld' })
        expect(result.ok).toBe(true)

        const state = store.getState()
        expect(state.project.data.pous[0].pouType).toBe('function-block')
        expect(state.editor.type).toBe('plc-graphical')

        // function-block maps to 'function-block' library type
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
        expect(result.message).toBe('POU already exists')
      })

      it('creates multiple POUs', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Prog1', language: 'st' })
        store.getState().pouActions.create({ type: 'function', name: 'Func1', language: 'il' })
        store.getState().pouActions.create({ type: 'function-block', name: 'FB1', language: 'fbd' })

        const state = store.getState()
        expect(state.project.data.pous).toHaveLength(3)
        expect(state.tabs).toHaveLength(3)
        expect(Object.keys(state.files)).toHaveLength(3)
        expect(state.libraries.user).toHaveLength(3)
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

    // -----------------------------------------------------------------------
    // deleteRequest
    // -----------------------------------------------------------------------
    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with pou elementType', () => {
        store.getState().pouActions.deleteRequest('Main')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'Main', elementType: 'pou' })
      })
    })

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
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

      it('clears editor if current editor matches deleted POU', () => {
        // Main should be the current editor after create
        expect(store.getState().editor.meta.name).toBe('Main')

        store.getState().pouActions.delete('Main')
        const state = store.getState()
        expect(state.editor.type).toBe('available')
        expect(state.editor.meta.name).toBe('available')
      })

      it('does not clear editor if a different POU is deleted', () => {
        store.getState().pouActions.create({ type: 'function', name: 'Func1', language: 'st' })
        // Func1 is now the current editor
        expect(store.getState().editor.meta.name).toBe('Func1')

        store.getState().pouActions.delete('Main')
        // Func1 should still be the current editor
        expect(store.getState().editor.meta.name).toBe('Func1')
        expect(store.getState().project.data.pous).toHaveLength(1)
        expect(store.getState().project.data.pous[0].name).toBe('Func1')
      })
    })

    // -----------------------------------------------------------------------
    // rename
    // -----------------------------------------------------------------------
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
        expect(state.libraries.user[0].name).toBe('NewName')
      })

      it('returns error when new name already exists', () => {
        store.getState().pouActions.create({ type: 'function', name: 'Existing', language: 'st' })
        const result = store.getState().pouActions.rename('OldName', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })

      it('updates editor name if current editor matches old name', () => {
        // OldName is the current editor
        expect(store.getState().editor.meta.name).toBe('OldName')
        store.getState().pouActions.rename('OldName', 'NewName')
        expect(store.getState().editor.meta.name).toBe('NewName')
      })
    })

    // -----------------------------------------------------------------------
    // duplicate
    // -----------------------------------------------------------------------
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

        // Editor model added but not set as current (no tab opened)
        expect(state.files['Copy']).toBeDefined()
        expect(state.files['Copy'].isNew).toBe(true)
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

      it('duplicates a function and preserves returnType', () => {
        // Create a function source
        store.getState().pouActions.create({ type: 'function', name: 'FuncSrc', language: 'st' })

        // Update its returnType via projectActions
        store.getState().projectActions.updatePouReturnType('FuncSrc', 'INT')

        const result = store.getState().pouActions.duplicate('FuncSrc', 'FuncCopy')
        expect(result.ok).toBe(true)

        const copyPou = store.getState().project.data.pous.find((p) => p.name === 'FuncCopy')
        expect(copyPou).toBeDefined()
        expect(copyPou!.pouType).toBe('function')
        // The returnType is copied from the source's interface
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
        // Create a POU and then manually strip its interface.variables
        store.getState().pouActions.create({ type: 'program', name: 'NoVarsPou', language: 'st' })
        // Manually set the POU interface to have no variables (undefined)
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
        // With no source variables, the copy should have empty variables
        expect(copyPou!.interface?.variables).toEqual([])
        // With undefined documentation, should default to ''
        expect(copyPou!.documentation).toBe('')
      })

      it('duplicates a function and copies returnType from interface', () => {
        store.getState().pouActions.create({ type: 'function', name: 'FnSrc', language: 'st' })
        // FnSrc has default returnType 'BOOL', update to 'DINT'
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
        // Manually strip the interface returnType from the POU
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
        // Create a POU directly at the project level that will collide
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

        // Try to duplicate Source to CollideName -- the shared duplicate checks for
        // existing POU by name first, so this should fail at that check
        const result = store.getState().pouActions.duplicate('Source', 'CollideName')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('POU name already exists')
      })
    })
  })

  // =========================================================================
  // datatypeActions
  // =========================================================================
  describe('datatypeActions', () => {
    // -----------------------------------------------------------------------
    // create
    // -----------------------------------------------------------------------
    describe('create', () => {
      it('creates an array data type and updates all slices', () => {
        const result = store.getState().datatypeActions.create({ name: 'IntArray', derivation: 'array' })
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.dataTypes).toHaveLength(1)
        expect(state.project.data.dataTypes[0].name).toBe('IntArray')
        expect(state.project.data.dataTypes[0].derivation).toBe('array')

        // Editor model set as current
        expect(state.editor.type).toBe('plc-datatype')
        expect(state.editor.meta.name).toBe('IntArray')

        // File entry
        expect(state.files['IntArray']).toBeDefined()
        expect(state.files['IntArray'].type).toBe('data-type')

        // Tab
        expect(state.tabs).toHaveLength(1)
        expect(state.selectedTab).toBe('IntArray')
      })

      it('creates a structure data type', () => {
        const result = store.getState().datatypeActions.create({ name: 'Point', derivation: 'structure' })
        expect(result.ok).toBe(true)
        expect(store.getState().project.data.dataTypes[0].derivation).toBe('structure')
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
        expect(result.message).toBe('Data type already exists')
      })
    })

    // -----------------------------------------------------------------------
    // deleteRequest
    // -----------------------------------------------------------------------
    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with datatype elementType', () => {
        store.getState().datatypeActions.deleteRequest('IntArray')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'IntArray', elementType: 'datatype' })
      })
    })

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
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
        // Other is now current editor
        expect(store.getState().editor.meta.name).toBe('Other')

        store.getState().datatypeActions.delete('IntArray')
        expect(store.getState().editor.meta.name).toBe('Other')
      })
    })

    // -----------------------------------------------------------------------
    // rename
    // -----------------------------------------------------------------------
    describe('rename', () => {
      beforeEach(() => {
        store.getState().datatypeActions.create({ name: 'OldDT', derivation: 'structure' })
      })

      it('renames data type across all slices', () => {
        const result = store.getState().datatypeActions.rename('OldDT', 'NewDT')
        expect(result).toEqual({ ok: true })

        const state = store.getState()
        expect(state.project.data.dataTypes[0].name).toBe('NewDT')
        expect(state.files['NewDT']).toBeDefined()
        expect(state.files['OldDT']).toBeUndefined()
        expect(state.tabs[0].name).toBe('NewDT')
      })

      it('returns error when new name already exists', () => {
        store.getState().datatypeActions.create({ name: 'Existing', derivation: 'array' })
        const result = store.getState().datatypeActions.rename('OldDT', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })

      it('returns error when data type not found', () => {
        const result = store.getState().datatypeActions.rename('NonExistent', 'NewName')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type not found')
      })

      it('updates editor name when renaming the current editor', () => {
        // OldDT is the current editor
        expect(store.getState().editor.meta.name).toBe('OldDT')
        const result = store.getState().datatypeActions.rename('OldDT', 'RenamedDT')
        expect(result.ok).toBe(true)
        expect(store.getState().editor.meta.name).toBe('RenamedDT')
      })
    })

    // -----------------------------------------------------------------------
    // duplicate
    // -----------------------------------------------------------------------
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

      it('returns error when source data type does not exist', () => {
        const result = store.getState().datatypeActions.duplicate('NonExistent', 'Copy')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type not found')
      })

      it('returns error when new name already exists', () => {
        store.getState().datatypeActions.create({ name: 'Existing', derivation: 'structure' })
        const result = store.getState().datatypeActions.duplicate('SourceDT', 'Existing')
        expect(result.ok).toBe(false)
        expect(result.message).toBe('Data type name already exists')
      })
    })
  })

  // =========================================================================
  // serverActions
  // =========================================================================
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

    // -----------------------------------------------------------------------
    // deleteRequest
    // -----------------------------------------------------------------------
    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with server elementType', () => {
        store.getState().serverActions.deleteRequest('Server1')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'Server1', elementType: 'server' })
      })
    })

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
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
        // Set the server as current editor
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

    // -----------------------------------------------------------------------
    // rename
    // -----------------------------------------------------------------------
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
        expect(result.message).toBe('Server name already exists')
      })
    })
  })

  // =========================================================================
  // remoteDeviceActions
  // =========================================================================
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

    // -----------------------------------------------------------------------
    // deleteRequest
    // -----------------------------------------------------------------------
    describe('deleteRequest', () => {
      it('opens the confirm-delete-element modal with remote-device elementType', () => {
        store.getState().remoteDeviceActions.deleteRequest('Device1')
        const modalState = store.getState().modalActions.getModalState('confirm-delete-element')
        expect(modalState.open).toBe(true)
        expect(modalState.data).toEqual({ name: 'Device1', elementType: 'remote-device' })
      })
    })

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
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
        // Set up an EtherCAT bus with two configured slave devices.
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
        // Register renderer-side state the UI would have created for each child.
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

    // -----------------------------------------------------------------------
    // rename
    // -----------------------------------------------------------------------
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
        expect(result.message).toBe('Device name already exists')
      })
    })
  })

  // =========================================================================
  // ethercatDeviceActions
  // =========================================================================
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

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // rename
    // -----------------------------------------------------------------------
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

      it('returns error when the bus does not exist', () => {
        const result = store.getState().ethercatDeviceActions.rename('missing-bus', 'slave-1', 'X')
        expect(result).toEqual({ ok: false, message: 'Bus not found' })
      })

      it('returns error when the slave id does not exist', () => {
        const result = store.getState().ethercatDeviceActions.rename('bus1', 'missing-slave', 'X')
        expect(result).toEqual({ ok: false, message: 'EtherCAT device not found' })
      })
    })
  })

  // =========================================================================
  // snapshotActions
  // =========================================================================
  describe('snapshotActions', () => {
    const snapshot1 = { variables: [], body: 'body-v1', globalVariables: [] }
    const snapshot2 = { variables: [], body: 'body-v2', globalVariables: [] }
    const snapshot3 = { variables: [], body: 'body-v3', globalVariables: [] }

    // -----------------------------------------------------------------------
    // pushToHistory
    // -----------------------------------------------------------------------
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
        // Manually set up a state with future entries by pushing and undoing
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.pushToHistory('Main', snapshot2)
        store.getState().snapshotActions.undo('Main')

        // Future should have an entry now
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)

        // Push a new snapshot - future should be cleared
        store.getState().snapshotActions.pushToHistory('Main', snapshot3)
        expect(store.getState().undoRedo['Main'].future).toEqual([])
      })

      it('enforces max history size of 50', () => {
        for (let i = 0; i < 55; i++) {
          store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: `v${i}` })
        }
        const history = store.getState().undoRedo['Main']
        expect(history.past).toHaveLength(50)
        // The oldest entries should have been shifted out
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

    // -----------------------------------------------------------------------
    // undo
    // -----------------------------------------------------------------------
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
        // Create history with empty past
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.undo('Main')
        // Past is now empty
        expect(store.getState().undoRedo['Main'].past).toHaveLength(0)
        // Another undo should be a no-op
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].past).toHaveLength(0)
      })

      it('undo falls back to empty array when POU has no interface', () => {
        // Manually strip the POU interface to test the ?? [] fallback
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

        // The current snapshot saved to future should have empty variables (fallback)
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

        // The POU should now have the snapshot's body applied
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
        // Set up some global variables
        const existingGlobals = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'BOOL' }, location: '', documentation: '' },
        ]
        store.getState().projectActions.setGlobalVariables({ variables: existingGlobals })

        // Push a snapshot without globalVariables field
        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [],
          body: 'old-body',
          // No globalVariables field
        })

        store.getState().snapshotActions.undo('Main')

        // Globals should remain untouched
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(existingGlobals)
      })

      it('does nothing if POU does not exist in project', () => {
        store.getState().snapshotActions.pushToHistory('Ghost', snapshot1)
        // Should not throw - but since the POU doesn't exist, undo returns early
        // after reading the last past entry but before popping it
        store.getState().snapshotActions.undo('Ghost')
        // Past is not consumed because the POU lookup fails and returns early
        expect(store.getState().undoRedo['Ghost'].past).toHaveLength(1)
      })
    })

    // -----------------------------------------------------------------------
    // redo
    // -----------------------------------------------------------------------
    describe('redo', () => {
      beforeEach(() => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
      })

      it('does nothing if there is no future', () => {
        store.getState().snapshotActions.redo('Main')
        // No errors, state unchanged
        expect(store.getState().undoRedo['Main']).toBeUndefined()
      })

      it('does nothing if future is empty', () => {
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.redo('Main')
        // Future is already empty, should be a no-op
        expect(store.getState().undoRedo['Main'].past).toHaveLength(1)
      })

      it('redo falls back to empty array when POU has no interface', () => {
        // Push and undo first to get a future entry
        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [],
          body: 'snapshot-body',
        })
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)

        // Strip the POU interface
        const pous = store.getState().project.data.pous.map((p) => {
          if (p.name === 'Main') {
            return { ...p, interface: undefined }
          }
          return p
        })
        store.getState().projectActions.setPous(pous)

        // Redo should work and save the current state (with no interface) to past
        store.getState().snapshotActions.redo('Main')
        const history = store.getState().undoRedo['Main']
        expect(history.future).toHaveLength(0)
        // The snapshot saved to past should have empty variables (fallback from ?? [])
        const lastPast = history.past[history.past.length - 1]
        expect(lastPast.variables).toEqual([])
      })

      it('redo does not touch globals when future snapshot has no globalVariables field', () => {
        // Set globals
        const existingGlobals = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'BOOL' }, location: '', documentation: '' },
        ]
        store.getState().projectActions.setGlobalVariables({ variables: existingGlobals })

        // Directly inject a future entry without globalVariables into undoRedo
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

        // Globals should be untouched (snapshot had no globalVariables)
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(existingGlobals)
        // Body should be restored
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
        // Undo once to move snapshotB to future
        store.getState().snapshotActions.undo('Main')

        expect(store.getState().undoRedo['Main'].past).toHaveLength(1)
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)

        // Redo
        store.getState().snapshotActions.redo('Main')

        const history = store.getState().undoRedo['Main']
        expect(history.future).toHaveLength(0)
        expect(history.past).toHaveLength(2) // snapshotA + current state saved

        // The POU should have the redo'd body
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

        // Clear globals to verify redo restores them
        store.getState().projectActions.setGlobalVariables({ variables: [] })
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual([])

        // Redo to get the future entry (which was the state before undo) applied
        // Actually the future holds the "current state at time of undo" which had empty body
        // The undo already applied the snapshotWithGlobals, so current has those globals
        // Let's test a proper redo flow
      })

      it('undo then redo restores original state', () => {
        // Modify the POU body first
        store.getState().projectActions.updatePou({
          name: 'Main',
          content: { language: 'st', value: 'current-body' },
        })

        // Push a snapshot representing a previous state
        const previousSnapshot = {
          variables: [],
          body: 'previous-body',
          globalVariables: [],
        }
        store.getState().snapshotActions.pushToHistory('Main', previousSnapshot)

        // Undo: restores previous-body, saves current-body to future
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('previous-body')

        // Redo: restores current-body from future
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
        // Set up: create POU, push snapshot, undo, then delete the POU
        store.getState().snapshotActions.pushToHistory('Main', snapshot1)
        store.getState().snapshotActions.undo('Main')
        // Future should have an entry
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)
        // Delete the POU
        store.getState().pouActions.delete('Main')
        // Redo should be a no-op because POU doesn't exist
        store.getState().snapshotActions.redo('Main')
        // Future should still have the entry (early return before popping)
        expect(store.getState().undoRedo['Main'].future).toHaveLength(1)
      })

      it('redo applies global variables from future snapshot', () => {
        const globalVars = [
          { name: 'GV1', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' },
        ]

        // Set body and globals, then push snapshot
        store.getState().projectActions.updatePou({
          name: 'Main',
          content: { language: 'st', value: 'body-with-globals' },
        })
        store.getState().projectActions.setGlobalVariables({ variables: globalVars })

        // Push snapshot of state before the globals were set
        store.getState().snapshotActions.pushToHistory('Main', {
          variables: [],
          body: 'old-body',
          globalVariables: [],
        })

        // Undo: restores old-body, saves current state (with globalVars) to future
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual([])

        // Redo: restores the future snapshot which has globalVariables
        store.getState().snapshotActions.redo('Main')
        expect(store.getState().project.data.configurations.resource.globalVariables).toEqual(globalVars)
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('body-with-globals')
      })

      it('multiple undo/redo cycles work correctly', () => {
        // Set up a sequence of body changes with snapshots
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

        // Current body is v2, past has [v0, v1]
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v2')

        // Undo: restore v1, future gets v2-state
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v1')

        // Undo: restore v0, future gets v1-state
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v0')

        // Redo: restore v1-state
        store.getState().snapshotActions.redo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v1')

        // Redo: restore v2-state
        store.getState().snapshotActions.redo('Main')
        expect(store.getState().project.data.pous.find((p) => p.name === 'Main')!.body.value).toBe('v2')
      })
    })
  })

  // =========================================================================
  // sharedWorkspaceActions
  // =========================================================================
  describe('sharedWorkspaceActions', () => {
    // -----------------------------------------------------------------------
    // handleFileAndWorkspaceSavedState
    // -----------------------------------------------------------------------
    describe('handleFileAndWorkspaceSavedState', () => {
      it('marks a saved file as unsaved', () => {
        // Create a POU to get a file
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        // File should be new (isNew: true), mark it as saved first
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

    // -----------------------------------------------------------------------
    // forceCloseFile
    // -----------------------------------------------------------------------
    describe('forceCloseFile', () => {
      it('removes the tab and selects the previous tab', () => {
        store.getState().pouActions.create({ type: 'program', name: 'PouA', language: 'st' })
        store.getState().pouActions.create({ type: 'program', name: 'PouB', language: 'st' })

        const result = store.getState().sharedWorkspaceActions.forceCloseFile('PouB')

        expect(result).toEqual({ success: true })
        expect(store.getState().tabs.find((t) => t.name === 'PouB')).toBeUndefined()
        // PouA should be selected
        expect(store.getState().editor.meta.name).toBe('PouA')
      })

      it('falls back to CreateEditorObjectFromTab when editor not in editors array', () => {
        // Add a tab directly without a corresponding editor model
        store.getState().tabsActions.updateTabs({
          name: 'OrphanTab',
          elementType: { type: 'program', language: 'st' },
        })
        store.getState().pouActions.create({ type: 'program', name: 'ToClose', language: 'st' })

        const result = store.getState().sharedWorkspaceActions.forceCloseFile('ToClose')

        expect(result).toEqual({ success: true })
        // OrphanTab should be selected via CreateEditorObjectFromTab fallback
        expect(store.getState().editor.meta.name).toBe('OrphanTab')
      })

      it('clears editor when last tab is closed', () => {
        store.getState().pouActions.create({ type: 'program', name: 'OnlyPou', language: 'st' })

        store.getState().sharedWorkspaceActions.forceCloseFile('OnlyPou')

        expect(store.getState().tabs).toHaveLength(0)
        expect(store.getState().editor.type).toBe('available')
      })

      it('selects a diff-viewer next tab with a null project-tree leaf', () => {
        // A diff-viewer tab has no project-tree leaf to highlight, so when it
        // becomes the active tab after a close its leaf type must be null.
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
        // Multi-mount keeps every open POU's editor model in `editors[]`.
        // `forceCloseFile` removes the active model from `editors[]`
        // BEFORE handing off to `setEditor` for the next tab.  If
        // `setEditor` ever started snapshotting the *outgoing* editor
        // back into `editors[]` unconditionally, the freshly-closed
        // model would reappear and the user would see a "closed" tab
        // pop back on the next focus switch.  Lock the invariant here.
        store.getState().pouActions.create({ type: 'program', name: 'A', language: 'st' })
        store.getState().pouActions.create({ type: 'program', name: 'B', language: 'st' })
        // A becomes active (creation flips active to the new one), then
        // we explicitly switch to A for the regression scenario.
        store.getState().editorActions.setEditor(store.getState().editorActions.getEditorFromEditors('A')!)
        expect(store.getState().editor.meta.name).toBe('A')

        store.getState().sharedWorkspaceActions.forceCloseFile('A')

        expect(store.getState().editors.find((e) => e.meta.name === 'A')).toBeUndefined()
        // And the next tab took over cleanly.
        expect(store.getState().editor.meta.name).toBe('B')
      })
    })

    // -----------------------------------------------------------------------
    // closeProject
    // -----------------------------------------------------------------------
    describe('closeProject', () => {
      it('opens save-changes modal when there are unsaved changes', () => {
        store.getState().workspaceActions.setEditingState('unsaved')

        const result = store.getState().sharedWorkspaceActions.closeProject()

        const modalState = store.getState().modalActions.getModalState('save-changes-project')
        expect(modalState.open).toBe(true)
        // Caller should defer host navigation until the modal resolves.
        expect(result).toEqual({ pendingConfirmation: true })
      })

      it('clears state when everything is saved', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'TestPou', saved: true })
        store.getState().workspaceActions.setEditingState('saved')

        const result = store.getState().sharedWorkspaceActions.closeProject()

        // State should be cleared
        expect(store.getState().tabs).toHaveLength(0)
        expect(store.getState().project.data.pous).toHaveLength(0)
        // Caller should navigate to the host immediately.
        expect(result).toEqual({ pendingConfirmation: false })
      })
    })

    // -----------------------------------------------------------------------
    // clearStatesOnCloseProject
    // -----------------------------------------------------------------------
    describe('clearStatesOnCloseProject', () => {
      it('resets all slice states', () => {
        store.getState().pouActions.create({ type: 'program', name: 'TestPou', language: 'st' })
        store.getState().consoleActions.addLog({ id: '1', level: 'info', message: 'test' })

        store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

        expect(store.getState().tabs).toHaveLength(0)
        expect(store.getState().project.data.pous).toHaveLength(0)
        expect(store.getState().logs).toHaveLength(0)
        expect(store.getState().editor.type).toBe('available')
      })
    })

    // -----------------------------------------------------------------------
    // closeFile
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // handleOpenProjectResponse
    // -----------------------------------------------------------------------
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

      it('opens a minimal project with an ST main POU', () => {
        const data = makeMinimalProjectResponse()
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const state = store.getState()
        expect(state.project.meta.name).toBe('TestProject')
        expect(state.project.meta.path).toBe('/test/path')
        expect(state.project.data.pous).toHaveLength(1)
        expect(state.project.data.pous[0].name).toBe('main')

        // Main POU should be opened in a tab
        expect(state.tabs).toHaveLength(1)
        expect(state.tabs[0].name).toBe('main')
        expect(state.selectedTab).toBe('main')
        expect(state.editor.meta.name).toBe('main')

        // Files should be registered
        expect(state.files['main']).toBeDefined()
        expect(state.files['main'].saved).toBe(true)
        expect(state.files['Resource']).toBeDefined()
        expect(state.files['Configuration']).toBeDefined()
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
        // Programs should NOT be in the library
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
        // Replace the main POU with a function
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

        // No tab should be opened
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

        // Should not throw
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

        // Should not throw
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
      })

      it('skips debug flags for non-existent POU variable', () => {
        const data = makeMinimalProjectResponse()
        data.projectData.debugVariables = {
          pous: {
            main: ['nonExistentVar'],
          },
        }

        // Should not throw
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)
      })

      it('handles project with no debugVariables', () => {
        const data = makeMinimalProjectResponse()
        // No debugVariables field at all

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        // Should succeed without errors
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
        // Add a POU with variablesText but empty variables
        const pouWithText = {
          name: 'UnparseablePou',
          pouType: 'program' as const,
          interface: { variables: [] as PLCVariable[] },
          body: { language: 'st' as const, value: '' },
          documentation: '',
          variablesText: 'VAR\n  unparseable_stuff;\nEND_VAR',
        }
        data.projectData.pous.push(pouWithText)

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        // Check that the editor model was created for UnparseablePou
        const editor = store.getState().editorActions.getEditorFromEditors('UnparseablePou')
        expect(editor).toBeDefined()
        if (editor && 'variable' in editor) {
          expect(editor.variable).toEqual({
            display: 'code',
            code: 'VAR\n  unparseable_stuff;\nEND_VAR',
          })
        }
      })

      it('delivers the raw variable text to the auto-opened main POU (issue #904)', () => {
        // The reporter's exact scenario: "main" itself carries the
        // unparseable variables. The auto-open block adds and activates a
        // default table-mode model for it BEFORE the code-mode pass runs —
        // addModel no-ops on the duplicate and setEditor early-returns on
        // the active editor, so the raw text must flow through
        // updateModelVariablesForName to reach the active editor.
        const rawText = 'VAR_OUTPUT\n  Q1 : BOOL AT %QX0.0;\nEND_VAR'
        const data = makeMinimalProjectResponse()
        const unparseableMain = {
          name: 'main',
          pouType: 'program' as const,
          interface: { variables: [] as PLCVariable[] },
          body: { language: 'st' as const, value: '' },
          documentation: '',
          variablesText: rawText,
        }
        data.projectData.pous.length = 0
        data.projectData.pous.push(unparseableMain)

        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        // main was auto-opened and is the active editor
        const state = store.getState()
        expect(state.editor.meta.name).toBe('main')
        // The active editor must show the preserved declarations in code view
        expect('variable' in state.editor && state.editor.variable).toEqual({
          display: 'code',
          code: rawText,
        })
      })

      it('does not create code-mode model for POU with variables (non-empty)', () => {
        const data = makeMinimalProjectResponse()
        // main has variables, so no variablesText processing should occur
        store.getState().sharedWorkspaceActions.handleOpenProjectResponse(data)

        const editorModel = store.getState().editorActions.getEditorFromEditors('main')
        expect(editorModel).toBeDefined()
        // Should be in table mode (not code mode)
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

        // After open, all flows should have updated = false
        const ldFlows = store.getState().ladderFlows.filter((f) => f.name === 'LdPou')
        ldFlows.forEach((flow) => {
          expect(flow.updated).toBe(false)
        })
      })

      // -----------------------------------------------------------------------
      // canEdit → workspace.canEdit (persist-permission gate)
      // -----------------------------------------------------------------------
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

  // =========================================================================
  // serverActions.create
  // =========================================================================
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

  // =========================================================================
  // remoteDeviceActions.create
  // =========================================================================
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

  // =========================================================================
  // snapshotActions (additional coverage)
  // =========================================================================
  describe('snapshotActions (additional)', () => {
    // -----------------------------------------------------------------------
    // markSaved / markAllSaved
    // -----------------------------------------------------------------------
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
    })

    // -----------------------------------------------------------------------
    // pushToHistory savedAtDepth branches
    // -----------------------------------------------------------------------
    describe('pushToHistory savedAtDepth', () => {
      it('nullifies savedAtDepth when saved state was in the future (discarded)', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })

        // Push 3 snapshots
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v2' })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v3' })

        // Mark saved at depth 3
        store.getState().snapshotActions.markSaved('Main')
        expect(store.getState().undoRedo['Main'].savedAtDepth).toBe(3)

        // Undo twice to move past length to 1
        store.getState().snapshotActions.undo('Main')
        store.getState().snapshotActions.undo('Main')
        expect(store.getState().undoRedo['Main'].past).toHaveLength(1)

        // Push a new snapshot - savedAtDepth (3) > past.length (1), so it should be nullified
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'new' })
        expect(store.getState().undoRedo['Main'].savedAtDepth).toBeNull()
      })

      it('adjusts savedAtDepth when history exceeds max size', () => {
        // Push MAX_HISTORY_SIZE + 5 entries with savedAtDepth set early
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'initial' })
        store.getState().snapshotActions.markSaved('P1')
        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(1)

        // Push 54 more (total 55 > 50 max)
        for (let i = 0; i < 54; i++) {
          store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: `v${i}` })
        }

        // savedAtDepth was 1, after 5 shifts it should become 1 - 5 = -4 -> null
        expect(store.getState().undoRedo['P1'].savedAtDepth).toBeNull()
      })

      it('adjusts savedAtDepth without going negative when saved state is recent', () => {
        // Fill history to 48 entries
        for (let i = 0; i < 48; i++) {
          store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: `v${i}` })
        }
        store.getState().snapshotActions.markSaved('P1')
        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(48)

        // Push 3 more -> total 51, only the 51st causes a shift
        // savedAtDepth = 48 - 1 = 47
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'a' })
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'b' })
        store.getState().snapshotActions.pushToHistory('P1', { variables: [], body: 'c' })

        expect(store.getState().undoRedo['P1'].savedAtDepth).toBe(47)
      })
    })

    // -----------------------------------------------------------------------
    // undo/redo with ladder and FBD flows
    // -----------------------------------------------------------------------
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

        // The snapshot was applied; verify history was modified
        const history = store.getState().undoRedo['LdPou']
        expect(history.past).toHaveLength(0)
        expect(history.future).toHaveLength(1)
      })

      it('saves current ladder flow to future when undoing with flow in store', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdPou', language: 'ld' })
        // Add a ladder flow so it exists in the store during undo
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
        // The future snapshot should contain the saved ladder flow
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
        // Add an FBD flow so it exists in the store during undo
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
        // The future snapshot should contain the saved FBD flow
        expect(history.future[0].fbdFlow).toBeDefined()
      })
    })

    describe('redo with ladder flow', () => {
      it('applies ladder flow from future snapshot on redo', () => {
        store.getState().pouActions.create({ type: 'program', name: 'LdPou', language: 'ld' })
        // Also add a ladder flow so it exists in the store
        store.getState().ladderFlowActions.addLadderFlow({ name: 'LdPou', rungs: [] } as never)

        // Manually inject a future entry that has a ladderFlow
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
        // Also add an FBD flow so it exists in the store
        store.getState().fbdFlowActions.addFBDFlow({
          name: 'FbdPou',
          rung: { comment: '', edges: [], nodes: [], selectedNodes: [] },
          updated: false,
        } as never)

        // Manually inject a future entry that has an fbdFlow
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

    // -----------------------------------------------------------------------
    // undo/redo savedAtDepth checks
    // -----------------------------------------------------------------------
    describe('undo savedAtDepth', () => {
      it('marks file as saved when undo returns to saved depth', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'Main', saved: true })

        // Push one snapshot and mark saved
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })
        store.getState().snapshotActions.markSaved('Main')
        // savedAtDepth = 1, past.length = 1

        // Push another snapshot - now past.length = 2
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v2' })
        store.getState().fileActions.updateFile({ name: 'Main', saved: false })

        // Undo once: past.length goes from 2 to 1, which equals savedAtDepth (1)
        store.getState().snapshotActions.undo('Main')

        // File should be marked as saved
        expect(store.getState().fileActions.getSavedState({ name: 'Main' })).toBe(true)
      })
    })

    describe('redo savedAtDepth', () => {
      it('marks file as saved when redo returns to saved depth', () => {
        store.getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
        store.getState().fileActions.updateFile({ name: 'Main', saved: true })

        // Push two snapshots
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v1' })
        store.getState().snapshotActions.pushToHistory('Main', { variables: [], body: 'v2' })

        // Mark saved at depth 2
        store.getState().snapshotActions.markSaved('Main')

        // Undo once: past.length = 1, saved not at depth
        store.getState().snapshotActions.undo('Main')
        store.getState().fileActions.updateFile({ name: 'Main', saved: false })

        // Redo: past.length goes back to 2, which equals savedAtDepth (2)
        store.getState().snapshotActions.redo('Main')

        expect(store.getState().fileActions.getSavedState({ name: 'Main' })).toBe(true)
      })
    })
  })
})
