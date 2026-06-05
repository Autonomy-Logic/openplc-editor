import { createStore } from 'zustand/vanilla'

import { createFileSlice } from '../slices/file/slice'
import type { FileSlice, FileSliceData, FileSliceDataObject, FileSliceType } from '../slices/file/types'

function makeStore() {
  return createStore<FileSlice>()(createFileSlice)
}

function makeFileData(overrides?: Partial<FileSliceData>): FileSliceData {
  return {
    type: overrides?.type ?? 'program',
    filePath: overrides?.filePath ?? '/data/pous/program/st/main',
    saved: overrides?.saved ?? true,
    isNew: overrides?.isNew,
    cleanState: overrides?.cleanState,
  }
}

function seedFile(
  store: ReturnType<typeof makeStore>,
  name: string,
  overrides?: Partial<{ type: FileSliceType; filePath: string; isNew: boolean; cleanState: unknown }>,
) {
  store.getState().fileActions.addFile({
    name,
    type: overrides?.type ?? 'program',
    filePath: overrides?.filePath ?? `/data/pous/program/st/${name}`,
    isNew: overrides?.isNew,
    cleanState: overrides?.cleanState,
  })
}

describe('createFileSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    expect(store.getState().files).toEqual({})
  })

  // -------------------------------------------------------------------------
  // setFiles
  // -------------------------------------------------------------------------
  it('setFiles merges files into the store', () => {
    const files: FileSliceDataObject = {
      main: makeFileData({ filePath: '/data/main' }),
      helper: makeFileData({ type: 'function', filePath: '/data/helper' }),
    }

    store.getState().fileActions.setFiles({ files })

    const state = store.getState().files
    expect(Object.keys(state)).toHaveLength(2)
    expect(state['main'].filePath).toBe('/data/main')
    expect(state['helper'].type).toBe('function')
  })

  it('setFiles merges with existing files', () => {
    seedFile(store, 'existing')

    const newFiles: FileSliceDataObject = {
      added: makeFileData({ filePath: '/data/added' }),
    }
    store.getState().fileActions.setFiles({ files: newFiles })

    const state = store.getState().files
    expect(Object.keys(state)).toHaveLength(2)
    expect(state['existing']).toBeDefined()
    expect(state['added']).toBeDefined()
  })

  it('setFiles overwrites existing file with same name', () => {
    seedFile(store, 'conflict', { filePath: '/old/path' })

    const files: FileSliceDataObject = {
      conflict: makeFileData({ filePath: '/new/path', type: 'function' }),
    }
    store.getState().fileActions.setFiles({ files })

    expect(store.getState().files['conflict'].filePath).toBe('/new/path')
    expect(store.getState().files['conflict'].type).toBe('function')
  })

  // -------------------------------------------------------------------------
  // addFile
  // -------------------------------------------------------------------------
  it('addFile adds a new file and returns true', () => {
    const result = store.getState().fileActions.addFile({
      name: 'main',
      type: 'program',
      filePath: '/data/main',
    })

    expect(result).toBe(true)
    const file = store.getState().files['main']
    expect(file).toBeDefined()
    expect(file.type).toBe('program')
    expect(file.filePath).toBe('/data/main')
    expect(file.saved).toBe(true)
  })

  it('addFile returns false when file already exists', () => {
    seedFile(store, 'duplicate')

    const result = store.getState().fileActions.addFile({
      name: 'duplicate',
      type: 'function',
      filePath: '/data/dupe',
    })

    expect(result).toBe(false)
  })

  it('addFile does not overwrite existing file when returning false', () => {
    seedFile(store, 'existing', { filePath: '/original/path' })

    store.getState().fileActions.addFile({
      name: 'existing',
      type: 'function-block',
      filePath: '/new/path',
    })

    expect(store.getState().files['existing'].filePath).toBe('/original/path')
    expect(store.getState().files['existing'].type).toBe('program')
  })

  it('addFile sets isNew and cleanState when provided', () => {
    store.getState().fileActions.addFile({
      name: 'new-file',
      type: 'data-type',
      filePath: '/data/dt',
      isNew: true,
      cleanState: { version: 1 },
    })

    const file = store.getState().files['new-file']
    expect(file.isNew).toBe(true)
    expect(file.cleanState).toEqual({ version: 1 })
  })

  it('addFile leaves isNew and cleanState undefined when not provided', () => {
    store.getState().fileActions.addFile({
      name: 'basic',
      type: 'program',
      filePath: '/data/basic',
    })

    const file = store.getState().files['basic']
    expect(file.isNew).toBeUndefined()
    expect(file.cleanState).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // removeFile
  // -------------------------------------------------------------------------
  it('removeFile deletes a file by name', () => {
    seedFile(store, 'to-remove')
    seedFile(store, 'to-keep')

    store.getState().fileActions.removeFile({ name: 'to-remove' })

    expect(store.getState().files['to-remove']).toBeUndefined()
    expect(store.getState().files['to-keep']).toBeDefined()
  })

  it('removeFile does nothing when file does not exist', () => {
    seedFile(store, 'only-one')

    store.getState().fileActions.removeFile({ name: 'nonexistent' })

    expect(Object.keys(store.getState().files)).toHaveLength(1)
    expect(store.getState().files['only-one']).toBeDefined()
  })

  it('removeFile on empty files does not throw', () => {
    expect(() => store.getState().fileActions.removeFile({ name: 'ghost' })).not.toThrow()
    expect(store.getState().files).toEqual({})
  })

  // -------------------------------------------------------------------------
  // updateFile
  // -------------------------------------------------------------------------
  it('updateFile updates saved state', () => {
    seedFile(store, 'main')

    store.getState().fileActions.updateFile({ name: 'main', saved: false })

    expect(store.getState().files['main'].saved).toBe(false)
  })

  it('updateFile updates filePath', () => {
    seedFile(store, 'main')

    store.getState().fileActions.updateFile({ name: 'main', filePath: '/new/path' })

    expect(store.getState().files['main'].filePath).toBe('/new/path')
  })

  it('updateFile updates isNew', () => {
    seedFile(store, 'main')

    store.getState().fileActions.updateFile({ name: 'main', isNew: true })

    expect(store.getState().files['main'].isNew).toBe(true)
  })

  it('updateFile updates cleanState', () => {
    seedFile(store, 'main')

    store.getState().fileActions.updateFile({ name: 'main', cleanState: { dirty: true } })

    expect(store.getState().files['main'].cleanState).toEqual({ dirty: true })
  })

  it('updateFile does nothing when file does not exist', () => {
    store.getState().fileActions.updateFile({ name: 'ghost', saved: false })

    expect(store.getState().files['ghost']).toBeUndefined()
  })

  it('updateFile renames a file when newName is provided', () => {
    seedFile(store, 'old-name', { filePath: '/data/pous/program/st/old-name' })

    store.getState().fileActions.updateFile({ name: 'old-name', newName: 'new-name' })

    expect(store.getState().files['old-name']).toBeUndefined()
    const renamed = store.getState().files['new-name']
    expect(renamed).toBeDefined()
    expect(renamed.filePath).toBe('/data/pous/program/st/new-name.json')
  })

  it('updateFile rename appends .json when newName has no extension', () => {
    seedFile(store, 'original', { filePath: '/project/src/original' })

    store.getState().fileActions.updateFile({ name: 'original', newName: 'renamed' })

    expect(store.getState().files['renamed'].filePath).toBe('/project/src/renamed.json')
  })

  it('updateFile rename preserves extension when newName includes one', () => {
    seedFile(store, 'original', { filePath: '/project/src/original' })

    store.getState().fileActions.updateFile({ name: 'original', newName: 'renamed.xml' })

    expect(store.getState().files['renamed.xml'].filePath).toBe('/project/src/renamed.xml')
  })

  it('updateFile rename does nothing when newName already exists', () => {
    seedFile(store, 'source', { filePath: '/data/source' })
    seedFile(store, 'target', { filePath: '/data/target' })

    store.getState().fileActions.updateFile({ name: 'source', newName: 'target' })

    expect(store.getState().files['source']).toBeDefined()
    expect(store.getState().files['target'].filePath).toBe('/data/target')
  })

  it('updateFile rename also applies other updates before renaming', () => {
    seedFile(store, 'file-a', { filePath: '/data/pous/program/st/file-a' })

    store.getState().fileActions.updateFile({ name: 'file-a', newName: 'file-b', saved: false })

    expect(store.getState().files['file-a']).toBeUndefined()
    const renamed = store.getState().files['file-b']
    expect(renamed).toBeDefined()
    expect(renamed.saved).toBe(false)
  })

  it('updateFile rename handles filePath with no directory', () => {
    store.getState().fileActions.addFile({
      name: 'flat',
      type: 'program',
      filePath: 'flat-file',
    })

    store.getState().fileActions.updateFile({ name: 'flat', newName: 'new-flat' })

    expect(store.getState().files['new-flat'].filePath).toBe('new-flat.json')
  })

  it('updateFile preserves fields when only partial updates are provided', () => {
    store.getState().fileActions.addFile({
      name: 'full',
      type: 'function-block',
      filePath: '/data/full',
      isNew: true,
      cleanState: { original: true },
    })

    store.getState().fileActions.updateFile({ name: 'full', saved: false })

    const file = store.getState().files['full']
    expect(file.type).toBe('function-block')
    expect(file.filePath).toBe('/data/full')
    expect(file.isNew).toBe(true)
    expect(file.cleanState).toEqual({ original: true })
    expect(file.saved).toBe(false)
  })

  // -------------------------------------------------------------------------
  // getFile
  // -------------------------------------------------------------------------
  it('getFile returns the file when it exists', () => {
    seedFile(store, 'target')

    const result = store.getState().fileActions.getFile({ name: 'target' })

    expect(result.file).toBeDefined()
    expect(result.file?.type).toBe('program')
  })

  it('getFile returns undefined when file does not exist', () => {
    const result = store.getState().fileActions.getFile({ name: 'missing' })

    expect(result.file).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // setAllToSaved
  // -------------------------------------------------------------------------
  it('setAllToSaved marks all files as saved', () => {
    seedFile(store, 'a')
    seedFile(store, 'b')
    store.getState().fileActions.updateFile({ name: 'a', saved: false })
    store.getState().fileActions.updateFile({ name: 'b', saved: false })

    store.getState().fileActions.setAllToSaved()

    expect(store.getState().files['a'].saved).toBe(true)
    expect(store.getState().files['b'].saved).toBe(true)
  })

  it('setAllToSaved on empty files does not throw', () => {
    expect(() => store.getState().fileActions.setAllToSaved()).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // setAllToUnsaved
  // -------------------------------------------------------------------------
  it('setAllToUnsaved marks all files as unsaved', () => {
    seedFile(store, 'a')
    seedFile(store, 'b')

    store.getState().fileActions.setAllToUnsaved()

    expect(store.getState().files['a'].saved).toBe(false)
    expect(store.getState().files['b'].saved).toBe(false)
  })

  it('setAllToUnsaved on empty files does not throw', () => {
    expect(() => store.getState().fileActions.setAllToUnsaved()).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // getSavedState
  // -------------------------------------------------------------------------
  it('getSavedState returns true for a saved file', () => {
    seedFile(store, 'saved-file')

    expect(store.getState().fileActions.getSavedState({ name: 'saved-file' })).toBe(true)
  })

  it('getSavedState returns false for an unsaved file', () => {
    seedFile(store, 'unsaved-file')
    store.getState().fileActions.updateFile({ name: 'unsaved-file', saved: false })

    expect(store.getState().fileActions.getSavedState({ name: 'unsaved-file' })).toBe(false)
  })

  it('getSavedState returns false for a nonexistent file', () => {
    expect(store.getState().fileActions.getSavedState({ name: 'missing' })).toBe(false)
  })

  // -------------------------------------------------------------------------
  // checkIfAllFilesAreSaved
  // -------------------------------------------------------------------------
  it('checkIfAllFilesAreSaved returns true when all files are saved', () => {
    seedFile(store, 'a')
    seedFile(store, 'b')

    expect(store.getState().fileActions.checkIfAllFilesAreSaved()).toBe(true)
  })

  it('checkIfAllFilesAreSaved returns false when any file is unsaved', () => {
    seedFile(store, 'a')
    seedFile(store, 'b')
    store.getState().fileActions.updateFile({ name: 'b', saved: false })

    expect(store.getState().fileActions.checkIfAllFilesAreSaved()).toBe(false)
  })

  it('checkIfAllFilesAreSaved returns true when files are empty', () => {
    expect(store.getState().fileActions.checkIfAllFilesAreSaved()).toBe(true)
  })

  // -------------------------------------------------------------------------
  // clearFiles
  // -------------------------------------------------------------------------
  it('clearFiles removes all files', () => {
    seedFile(store, 'a')
    seedFile(store, 'b')
    seedFile(store, 'c')

    store.getState().fileActions.clearFiles()

    expect(store.getState().files).toEqual({})
  })

  it('clearFiles on empty state is a no-op', () => {
    store.getState().fileActions.clearFiles()

    expect(store.getState().files).toEqual({})
  })
})
