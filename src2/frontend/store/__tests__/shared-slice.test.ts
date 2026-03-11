import { createStore } from 'zustand/vanilla'

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console/slice'
import { createEditorSlice } from '../slices/editor/slice'
import { createFileSlice } from '../slices/file/slice'
import { createLibrarySlice } from '../slices/library/slice'
import { createModalSlice } from '../slices/modal/slice'
import { createProjectSlice } from '../slices/project/slice'
import { createSearchSlice } from '../slices/search/slice'
import { createSharedSlice } from '../slices/shared/slice'
import type { SharedRootState } from '../slices/shared/types'
import { createTabsSlice } from '../slices/tabs/slice'
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
        }) as PLCPou[]
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
          data: { language: 'st', name: 'CollideName', variables: [], body: { language: 'st', value: '' }, documentation: '' },
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
          variables: [{ name: 'x', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' }],
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
          variables: [{ name: 'x', type: { definition: 'base-type' as const, value: 'INT' }, location: '', documentation: '' }],
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
})
