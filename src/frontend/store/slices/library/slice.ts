import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { SharedRootState } from '../shared/types'
import type { LibraryProjectRef, LibrarySlice } from './types'

/**
 * The library slice is created with a narrow `LibrarySlice` state
 * type so its existing unit tests can spin up a slim store.  At
 * runtime the slice runs as part of the full root store, so the
 * three project-aware actions below cast the zustand getter once to
 * `SharedRootState` to read `project.data.libraries`.  This keeps
 * the legacy test ergonomics intact while giving the manager UI
 * the cross-slice view it needs.
 */
const createLibrarySlice: StateCreator<LibrarySlice, [], [], LibrarySlice> = (setState, getState) => {
  /** Read the project's durable library list when the slice runs in
   *  the full app; falls back to an empty list when running under a
   *  narrow test harness.  The cast is the only place we step
   *  outside the slice's own state type. */
  const readProjectRefs = (): LibraryProjectRef[] => {
    const wider = getState() as unknown as Partial<SharedRootState>
    return wider.project?.data?.libraries ?? []
  }

  /** Mutate the project's durable list under the same wide-state
   *  draft.  No-op when the project slice isn't present (test
   *  harness). */
  const mutateProjectRefs = (state: LibrarySlice, fn: (refs: LibraryProjectRef[]) => LibraryProjectRef[]): void => {
    const wider = state as unknown as Partial<SharedRootState>
    if (!wider.project) return
    if (!wider.project.data.libraries) wider.project.data.libraries = []
    wider.project.data.libraries = fn(wider.project.data.libraries)
  }

  return {
    libraries: {
      system: [],
      user: [],
    },
    enabledLibraries: [],
    bundledLibraryNames: [],
    missingLibraries: [],
    libraryActions: {
      setSystemLibraries: (libraries) => {
        // Strip malformed POU entries at the source — keep only
        // entries with a non-empty string `name`.  Render-path
        // consumers (variables-table / global-variables-table /
        // structure / array selectable cells) assume every pou has
        // a usable name and `pou.name.toUpperCase()` crashes
        // otherwise.  Doing it here means every consumer is safe
        // by construction; no per-component defensive code.
        const sanitized = libraries.map((lib) => ({
          ...lib,
          pous: (lib.pous ?? []).filter((pou) => typeof pou?.name === 'string' && pou.name.length > 0),
        }))
        setState(
          produce((state: LibrarySlice) => {
            state.libraries.system = sanitized
            // System pool changed — refresh the derived diff against
            // the project's current durable list.  Empty when the
            // project slice isn't wired (slim test harness).
            const refs = readProjectRefs()
            state.enabledLibraries = computeEnabled(sanitized, refs)
            state.missingLibraries = computeMissing(sanitized, refs)
          }),
        )
      },
      addLibrary: (libraryName, libraryType) => {
        // Drop malformed input at the source — render paths that
        // later iterate `libraries.user` (variables / global / array
        // / structure selectable cells) assume every entry has a
        // non-empty string name and crash otherwise with `Cannot
        // read properties of undefined (reading 'toUpperCase')`.
        if (typeof libraryName !== 'string' || libraryName.length === 0) return
        if (typeof libraryType !== 'string' || libraryType.length === 0) return
        setState(
          produce(({ libraries: { user: userLibraries } }: LibrarySlice) => {
            const libraryAlreadyExists = userLibraries.some((library) => library.name === libraryName)
            if (!libraryAlreadyExists) {
              userLibraries.push({ name: libraryName, type: libraryType })
            }
          }),
        )
      },
      updateLibraryName: (libraryName, newLibraryName) => {
        setState(
          produce(({ libraries: { user: userLibraries } }: LibrarySlice) => {
            const currentIndex = userLibraries.findIndex((lib) => lib.name === libraryName)
            if (currentIndex === -1) return

            const nextName = newLibraryName.trim()
            if (nextName.length === 0) return

            const conflictIndex = userLibraries.findIndex((lib) => lib.name === nextName)
            if (conflictIndex !== -1 && conflictIndex !== currentIndex) return

            userLibraries[currentIndex].name = nextName
          }),
        )
      },
      clearUserLibraries: () => {
        setState(
          produce((state: LibrarySlice) => {
            state.libraries.user = []
          }),
        )
      },
      removeUserLibrary: (libraryName) => {
        setState(
          produce(({ libraries: { user: userLibraries } }: LibrarySlice) => {
            const libraryIndex = userLibraries.findIndex((library) => library.name === libraryName)
            if (libraryIndex === -1) return
            userLibraries.splice(libraryIndex, 1)
          }),
        )
      },

      enableLibrary: (name) => {
        setState(
          produce((state: LibrarySlice) => {
            const target = state.libraries.system.find((lib) => lib.name === name)
            if (!target) return // not in pool — no-op
            mutateProjectRefs(state, (refs) =>
              refs.some((r) => r.name === name) ? refs : [...refs, { name, version: target.version }],
            )
            if (!state.enabledLibraries.includes(name)) {
              state.enabledLibraries.push(name)
            }
            state.missingLibraries = state.missingLibraries.filter((m) => m.name !== name)
          }),
        )
      },

      disableLibrary: (name) => {
        setState(
          produce((state: LibrarySlice) => {
            mutateProjectRefs(state, (refs) => refs.filter((r) => r.name !== name))
            state.enabledLibraries = state.enabledLibraries.filter((n) => n !== name)
          }),
        )
      },

      setProjectLibraries: (refs) => {
        setState(
          produce((state: LibrarySlice) => {
            // Mirror into the project slice (when present) so the
            // durable list and the derived view stay in sync.
            mutateProjectRefs(state, () => refs.map((r) => ({ name: r.name, version: r.version })))
            state.enabledLibraries = computeEnabled(state.libraries.system, refs)
            state.missingLibraries = computeMissing(state.libraries.system, refs)
          }),
        )
      },
      setBundledLibraryNames: (names) => {
        setState(
          produce((state: LibrarySlice) => {
            state.bundledLibraryNames = names
          }),
        )
      },
    },
  }
}

function computeEnabled(pool: LibrarySlice['libraries']['system'], refs: LibraryProjectRef[]): string[] {
  const poolNames = new Set(pool.map((lib) => lib.name))
  return refs.filter((r) => poolNames.has(r.name)).map((r) => r.name)
}

function computeMissing(
  pool: LibrarySlice['libraries']['system'],
  refs: LibraryProjectRef[],
): { name: string; version?: string }[] {
  const poolNames = new Set(pool.map((lib) => lib.name))
  return refs.filter((r) => !poolNames.has(r.name)).map((r) => ({ name: r.name, version: r.version }))
}

export { createLibrarySlice }
