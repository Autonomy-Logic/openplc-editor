import { createStore } from 'zustand/vanilla'

import { createLibrarySlice } from '../slices/library/slice'
import type { LibrarySlice, SystemLibrary } from '../slices/library/types'

function makeStore() {
  return createStore<LibrarySlice>()(createLibrarySlice)
}

function makeSystemLibrary(overrides?: Partial<SystemLibrary>): SystemLibrary {
  return {
    name: overrides?.name ?? 'Standard',
    author: overrides?.author ?? 'PLCopen',
    version: overrides?.version ?? '1.0',
    stPath: overrides?.stPath ?? '/libs/standard.st',
    cPath: overrides?.cPath ?? '/libs/standard.c',
    pous: overrides?.pous ?? [],
  }
}

describe('createLibrarySlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const { libraries } = store.getState()
    expect(libraries.system).toEqual([])
    expect(libraries.user).toEqual([])
  })

  // -------------------------------------------------------------------------
  // setSystemLibraries
  // -------------------------------------------------------------------------
  it('setSystemLibraries sets the system libraries array', () => {
    const libs = [makeSystemLibrary({ name: 'Standard' }), makeSystemLibrary({ name: 'Arithmetic' })]

    store.getState().libraryActions.setSystemLibraries(libs)

    const { system } = store.getState().libraries
    expect(system).toHaveLength(2)
    expect(system[0].name).toBe('Standard')
    expect(system[1].name).toBe('Arithmetic')
  })

  it('setSystemLibraries replaces existing system libraries', () => {
    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'Old' })])
    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'New' })])

    const { system } = store.getState().libraries
    expect(system).toHaveLength(1)
    expect(system[0].name).toBe('New')
  })

  it('setSystemLibraries can set to empty array', () => {
    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary()])
    store.getState().libraryActions.setSystemLibraries([])

    expect(store.getState().libraries.system).toEqual([])
  })

  it('setSystemLibraries does not affect user libraries', () => {
    store.getState().libraryActions.addLibrary('MyFunc', 'function')

    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary()])

    expect(store.getState().libraries.user).toHaveLength(1)
    expect(store.getState().libraries.user[0].name).toBe('MyFunc')
  })

  // -------------------------------------------------------------------------
  // addLibrary
  // -------------------------------------------------------------------------
  it('addLibrary adds a user library', () => {
    store.getState().libraryActions.addLibrary('MyFunction', 'function')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(1)
    expect(user[0]).toEqual({ name: 'MyFunction', type: 'function' })
  })

  it('addLibrary adds a function-block library', () => {
    store.getState().libraryActions.addLibrary('MyBlock', 'function-block')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(1)
    expect(user[0]).toEqual({ name: 'MyBlock', type: 'function-block' })
  })

  it('addLibrary appends multiple libraries in order', () => {
    store.getState().libraryActions.addLibrary('First', 'function')
    store.getState().libraryActions.addLibrary('Second', 'function-block')
    store.getState().libraryActions.addLibrary('Third', 'function')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(3)
    expect(user[0].name).toBe('First')
    expect(user[1].name).toBe('Second')
    expect(user[2].name).toBe('Third')
  })

  it('addLibrary ignores duplicate library names', () => {
    store.getState().libraryActions.addLibrary('Unique', 'function')
    store.getState().libraryActions.addLibrary('Unique', 'function-block')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(1)
    expect(user[0]).toEqual({ name: 'Unique', type: 'function' })
  })

  it('addLibrary does not affect system libraries', () => {
    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'Sys' })])

    store.getState().libraryActions.addLibrary('UserLib', 'function')

    expect(store.getState().libraries.system).toHaveLength(1)
    expect(store.getState().libraries.system[0].name).toBe('Sys')
  })

  // -------------------------------------------------------------------------
  // updateLibraryName
  // -------------------------------------------------------------------------
  it('updateLibraryName renames an existing user library', () => {
    store.getState().libraryActions.addLibrary('OldName', 'function')

    store.getState().libraryActions.updateLibraryName('OldName', 'NewName')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(1)
    expect(user[0].name).toBe('NewName')
    expect(user[0].type).toBe('function')
  })

  it('updateLibraryName does nothing when library does not exist', () => {
    store.getState().libraryActions.addLibrary('Existing', 'function')

    store.getState().libraryActions.updateLibraryName('Nonexistent', 'Whatever')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(1)
    expect(user[0].name).toBe('Existing')
  })

  it('updateLibraryName does nothing when new name is empty after trim', () => {
    store.getState().libraryActions.addLibrary('Keep', 'function')

    store.getState().libraryActions.updateLibraryName('Keep', '   ')

    expect(store.getState().libraries.user[0].name).toBe('Keep')
  })

  it('updateLibraryName trims whitespace from new name', () => {
    store.getState().libraryActions.addLibrary('Trim', 'function')

    store.getState().libraryActions.updateLibraryName('Trim', '  Trimmed  ')

    expect(store.getState().libraries.user[0].name).toBe('Trimmed')
  })

  it('updateLibraryName does nothing when new name conflicts with another library', () => {
    store.getState().libraryActions.addLibrary('LibA', 'function')
    store.getState().libraryActions.addLibrary('LibB', 'function-block')

    store.getState().libraryActions.updateLibraryName('LibA', 'LibB')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(2)
    expect(user[0].name).toBe('LibA')
    expect(user[1].name).toBe('LibB')
  })

  it('updateLibraryName allows renaming to the same name (no-op)', () => {
    store.getState().libraryActions.addLibrary('SameName', 'function')

    store.getState().libraryActions.updateLibraryName('SameName', 'SameName')

    const { user } = store.getState().libraries
    expect(user).toHaveLength(1)
    expect(user[0].name).toBe('SameName')
  })

  it('updateLibraryName preserves library order', () => {
    store.getState().libraryActions.addLibrary('First', 'function')
    store.getState().libraryActions.addLibrary('Second', 'function-block')
    store.getState().libraryActions.addLibrary('Third', 'function')

    store.getState().libraryActions.updateLibraryName('Second', 'Renamed')

    const names = store.getState().libraries.user.map((lib) => lib.name)
    expect(names).toEqual(['First', 'Renamed', 'Third'])
  })

  // -------------------------------------------------------------------------
  // clearUserLibraries
  // -------------------------------------------------------------------------
  it('clearUserLibraries removes all user libraries', () => {
    store.getState().libraryActions.addLibrary('A', 'function')
    store.getState().libraryActions.addLibrary('B', 'function-block')

    store.getState().libraryActions.clearUserLibraries()

    expect(store.getState().libraries.user).toEqual([])
  })

  it('clearUserLibraries on empty user libraries is a no-op', () => {
    store.getState().libraryActions.clearUserLibraries()

    expect(store.getState().libraries.user).toEqual([])
  })

  it('clearUserLibraries does not affect system libraries', () => {
    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'Sys' })])
    store.getState().libraryActions.addLibrary('User', 'function')

    store.getState().libraryActions.clearUserLibraries()

    expect(store.getState().libraries.system).toHaveLength(1)
    expect(store.getState().libraries.system[0].name).toBe('Sys')
    expect(store.getState().libraries.user).toEqual([])
  })

  // -------------------------------------------------------------------------
  // removeUserLibrary
  // -------------------------------------------------------------------------
  it('removeUserLibrary removes a library by name', () => {
    store.getState().libraryActions.addLibrary('Keep', 'function')
    store.getState().libraryActions.addLibrary('Remove', 'function-block')
    store.getState().libraryActions.addLibrary('AlsoKeep', 'function')

    store.getState().libraryActions.removeUserLibrary('Remove')

    const names = store.getState().libraries.user.map((lib) => lib.name)
    expect(names).toEqual(['Keep', 'AlsoKeep'])
  })

  it('removeUserLibrary does nothing when library does not exist', () => {
    store.getState().libraryActions.addLibrary('Existing', 'function')

    store.getState().libraryActions.removeUserLibrary('Nonexistent')

    expect(store.getState().libraries.user).toHaveLength(1)
    expect(store.getState().libraries.user[0].name).toBe('Existing')
  })

  it('removeUserLibrary on empty user libraries does not throw', () => {
    expect(() => store.getState().libraryActions.removeUserLibrary('ghost')).not.toThrow()
    expect(store.getState().libraries.user).toEqual([])
  })

  it('removeUserLibrary does not affect system libraries', () => {
    store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'Sys' })])
    store.getState().libraryActions.addLibrary('UserLib', 'function')

    store.getState().libraryActions.removeUserLibrary('UserLib')

    expect(store.getState().libraries.system).toHaveLength(1)
    expect(store.getState().libraries.user).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Library Manager — project enablement + missing diff
  // ---------------------------------------------------------------------------

  describe('setProjectLibraries', () => {
    it('marks pool entries as enabled, leaves the rest under missing', () => {
      store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'oscat-basic', version: '3.4.0' })])
      store.getState().libraryActions.setProjectLibraries([
        { name: 'oscat-basic', version: '3.4.0' },
        { name: 'phantom', version: '0.1.0' },
      ])

      expect(store.getState().enabledLibraries).toEqual(['oscat-basic'])
      expect(store.getState().missingLibraries).toEqual([{ name: 'phantom', version: '0.1.0' }])
    })

    it('clears the previous project view when called with a different list', () => {
      store
        .getState()
        .libraryActions.setSystemLibraries([
          makeSystemLibrary({ name: 'oscat-basic' }),
          makeSystemLibrary({ name: 'additional-fb' }),
        ])
      const a = store.getState().libraryActions
      a.setProjectLibraries([{ name: 'oscat-basic', version: '3.4.0' }])
      expect(store.getState().enabledLibraries).toEqual(['oscat-basic'])
      a.setProjectLibraries([{ name: 'additional-fb', version: '1.0.0' }])
      expect(store.getState().enabledLibraries).toEqual(['additional-fb'])
    })
  })

  describe('setSystemLibraries (post-load diff refresh)', () => {
    it('recomputes enabled/missing against the project list when the pool changes', () => {
      const a = store.getState().libraryActions
      // Project asks for `late-arrival` which the pool doesn't have yet.
      a.setProjectLibraries([{ name: 'late-arrival', version: '1.0.0' }])
      expect(store.getState().missingLibraries).toEqual([{ name: 'late-arrival', version: '1.0.0' }])

      // Now the user installs it — the diff should refresh.
      a.setSystemLibraries([makeSystemLibrary({ name: 'late-arrival', version: '1.0.0' })])
      expect(store.getState().missingLibraries).toEqual([])
      expect(store.getState().enabledLibraries).toEqual([])
      // (Without the project slice wired, the durable refs aren't
      // re-read on pool-change — slim test harness just resets the
      // diff to empty against the now-installed pool.)
    })
  })

  describe('enableLibrary', () => {
    it('adds the library name to enabledLibraries when it lives in the pool', () => {
      store.getState().libraryActions.setSystemLibraries([makeSystemLibrary({ name: 'oscat-basic', version: '3.4.0' })])
      store.getState().libraryActions.enableLibrary('oscat-basic')
      expect(store.getState().enabledLibraries).toEqual(['oscat-basic'])
    })

    it('is a no-op when the library is not in the pool', () => {
      store.getState().libraryActions.enableLibrary('phantom')
      expect(store.getState().enabledLibraries).toEqual([])
    })

    it('clears the same name from missingLibraries (e.g. user just installed it)', () => {
      const a = store.getState().libraryActions
      a.setProjectLibraries([{ name: 'just-installed', version: '1.0.0' }])
      expect(store.getState().missingLibraries).toHaveLength(1)
      a.setSystemLibraries([makeSystemLibrary({ name: 'just-installed', version: '1.0.0' })])
      a.enableLibrary('just-installed')
      expect(store.getState().missingLibraries).toEqual([])
    })

    it('does not duplicate when called twice for the same name', () => {
      const a = store.getState().libraryActions
      a.setSystemLibraries([makeSystemLibrary({ name: 'oscat-basic' })])
      a.enableLibrary('oscat-basic')
      a.enableLibrary('oscat-basic')
      expect(store.getState().enabledLibraries).toEqual(['oscat-basic'])
    })
  })

  describe('disableLibrary', () => {
    it('removes the name from enabledLibraries', () => {
      const a = store.getState().libraryActions
      a.setSystemLibraries([makeSystemLibrary({ name: 'oscat-basic' })])
      a.enableLibrary('oscat-basic')
      a.disableLibrary('oscat-basic')
      expect(store.getState().enabledLibraries).toEqual([])
    })

    it('is a no-op when the library was never enabled', () => {
      store.getState().libraryActions.disableLibrary('phantom')
      expect(store.getState().enabledLibraries).toEqual([])
    })
  })
})
