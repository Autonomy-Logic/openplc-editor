import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { compareSemver } from '../../../utils/semver'
import type { SharedRootState } from '../shared/types'
import type { LibraryProjectRef, LibrarySlice, OutdatedLibrary, SystemLibrary } from './types'

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
    installedLibraries: [],
    enabledLibraries: [],
    bundledLibraryNames: [],
    missingLibraries: [],
    outdatedLibraries: [],
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
            // `sanitized` carries every installed version; `system` carries
            // the one this project uses.  Kept apart so switching a project's
            // pinned version needs no round trip to the main process.
            state.installedLibraries = sanitized
            const refs = readProjectRefs()
            state.libraries.system = effectivePool(sanitized, refs)
            state.enabledLibraries = computeEnabled(state.libraries.system, refs)
            state.missingLibraries = computeMissing(state.libraries.system, refs)
            state.outdatedLibraries = computeOutdated(sanitized, refs)
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
            // Re-derive: the project may pin versions other than the newest.
            const installed = poolToNarrow(state)
            state.libraries.system = effectivePool(installed, refs)
            state.enabledLibraries = computeEnabled(state.libraries.system, refs)
            state.missingLibraries = computeMissing(state.libraries.system, refs)
            state.outdatedLibraries = computeOutdated(installed, refs)
          }),
        )
      },
      setLibraryVersion: (name, version) => {
        setState(
          produce((state: LibrarySlice) => {
            let refs = readProjectRefs()
            if (!refs.some((ref) => ref.name === name)) return
            refs = refs.map((ref) => (ref.name === name ? { name, version } : ref))
            mutateProjectRefs(state, () => refs)
            const installed = poolToNarrow(state)
            state.libraries.system = effectivePool(installed, refs)
            state.enabledLibraries = computeEnabled(state.libraries.system, refs)
            state.missingLibraries = computeMissing(state.libraries.system, refs)
            state.outdatedLibraries = computeOutdated(installed, refs)
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

/**
 * What to narrow the project's view from.
 *
 * `installedLibraries` is empty until the pool has been hydrated, and
 * narrowing an empty list would blank `libraries.system` -- which drops every
 * library block's type and marks its instance variable unresolvable. Fall back
 * to the pool already on show, which for one version per library is the same
 * list.
 */
function poolToNarrow(state: LibrarySlice): SystemLibrary[] {
  return state.installedLibraries.length > 0 ? state.installedLibraries : state.libraries.system
}

/** Installed libraries grouped by name, insertion order preserved. */
function groupByName(installed: SystemLibrary[]): Map<string, SystemLibrary[]> {
  const byName = new Map<string, SystemLibrary[]>()
  for (const library of installed) {
    const found = byName.get(library.name)
    if (found) found.push(library)
    else byName.set(library.name, [library])
  }
  return byName
}

const newestFirst = (libraries: SystemLibrary[]): SystemLibrary[] =>
  [...libraries].sort((a, b) => compareSemver(b.version, a.version))

/**
 * One library per name: the version the project pins, or the newest installed.
 *
 * Two versions of one library cannot share a compile, and placing a block from
 * one while building against the other is the same mistake in the editor, so
 * the pool the UI sees is narrowed the same way the compile is.
 */
function effectivePool(installed: SystemLibrary[], refs: LibraryProjectRef[]): SystemLibrary[] {
  const pinned = new Map(refs.map((ref) => [ref.name, ref.version]))
  const out: SystemLibrary[] = []
  for (const [name, versions] of groupByName(installed)) {
    if (versions.length === 1) {
      out.push(versions[0])
      continue
    }
    const want = pinned.get(name)
    out.push(versions.find((library) => library.version === want) ?? newestFirst(versions)[0])
  }
  return out
}

/** Libraries the project pins below a version it already has installed. */
function computeOutdated(installed: SystemLibrary[], refs: LibraryProjectRef[]): OutdatedLibrary[] {
  const byName = groupByName(installed)
  const outdated: OutdatedLibrary[] = []
  for (const ref of refs) {
    const versions = byName.get(ref.name)
    if (!versions || !ref.version) continue
    const available = newestFirst(versions).map((library) => library.version)
    if (compareSemver(available[0], ref.version) > 0) {
      outdated.push({ name: ref.name, pinned: ref.version, available })
    }
  }
  return outdated
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
