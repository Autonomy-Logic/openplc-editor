export type LibraryPouType = 'function' | 'function-block'
/** Body language as the library presents it to consumers.  `cpp`
 *  surfaces user-authored C/C++ function blocks the library ships
 *  via `archive.cppBlocks` — strucpp doesn't compile them; the
 *  consumer's program build grafts them into the project's own
 *  C/C++-POU pipeline.  ST/IL/LD/SFC/FBD libraries are
 *  strucpp-compiled and the chunks ride the manifest entries. */
export type LibraryLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'cpp'

export interface SystemLibraryVariable {
  name: string
  /**
   * Pin role on the resulting block:
   *  - `input` / `output` for normal pins
   *  - `inOut` (camelCase) for IEC `VAR_IN_OUT` pins, which read/write
   *    through a single bidirectional connection
   *  - `local` for FB-internal state surfaced for inspection (rare in
   *    library-supplied entries; primarily used by user-authored POUs)
   */
  class: 'input' | 'output' | 'local' | 'inOut'
  type:
    | { definition: 'base-type'; value: string }
    | { definition: 'derived-type'; value: string }
    | { definition: 'generic-type'; value: string }
  location?: string
  initialValue?: unknown
  documentation?: string
}

export interface SystemLibraryPou {
  name: string
  type: LibraryPouType
  language: LibraryLanguage
  variables: SystemLibraryVariable[]
  /**
   * Body source text. Reserved for future preview / code-completion
   * tooling; the library tree itself never reads it. Defaults to `''`
   * for `.stlib`-sourced libraries since strucpp keeps the canonical
   * body alongside compiled output, not in the manifest.
   */
  body: string
  documentation: string
  /**
   * IEC-style extensible (variadic) function: ADD/MUL/AND/MUX accept any
   * number of additional pins past the declared parameter list. The
   * graphical editors render a "+" handle to grow inputs when this is
   * set; type-checking unifies all extra pins with the trailing
   * declared parameter's type.
   */
  extensible?: boolean
  /**
   * Slash-separated folder path inside the originating library (e.g.
   * `"POUs/Time&Date"` for an OSCAT FB, `"Arithmetic"` for an std
   * function). Empty/undefined puts the entry at the library root.
   * Comes straight from the .stlib manifest's per-entry `category`
   * field — see strucpp's library-manifest contract.
   */
  category?: string
}

export interface SystemLibrary {
  name: string
  /**
   * Human-readable label rendered in the library tree as the root
   * folder title (e.g. "Standard Function Blocks" instead of the
   * kebab-case `iec-standard-fb` identifier). Falls back to `name`
   * when the source .stlib doesn't ship one.
   */
  displayName?: string
  author: string
  version: string
  stPath: string
  cPath: string
  pous: SystemLibraryPou[]
}

export interface UserLibrary {
  name: string
  type: 'function' | 'function-block' | 'program'
}

export type LibraryState = {
  libraries: {
    system: SystemLibrary[]
    user: UserLibrary[]
  }
}

// ---------------------------------------------------------------------------
// Library Manager wire types
// ---------------------------------------------------------------------------

/**
 * One row in the system-wide library pool the manager surfaces.
 * Mirrors the shape `PackageManagerModule` uses for hardware plugins,
 * adapted to library identity.
 *
 * `bundled: true` marks libraries that ship with strucpp itself
 * (everything in `<resources>/strucpp/libs/`) — they're the
 * canonical, non-disableable IEC base set and grow whenever a future
 * strucpp release bundles more.  User-installed libraries (.stlib or
 * .lib/.library) all surface with `bundled: false`.
 */
export interface InstalledLibrary {
  /** The strucpp manifest `name` — same identifier projects record
   *  in `project.json`'s `libraries[]` and the value the system pool
   *  is keyed on. */
  name: string
  version: string
  bundled: boolean
  /** ISO timestamp; empty string for bundled libs (which have no
   *  meaningful "installed at" — they ship with the editor). */
  installedAt: string
  /** Source the user installed from.  `'stlib'` for direct archive
   *  imports, `'codesys'` when the editor ran the .lib/.library
   *  through strucpp's CODESYS importer.  `'bundled'` for the
   *  always-on set. */
  origin: 'stlib' | 'codesys' | 'bundled'
  /** Optional human-readable label from the manifest.  Falls back
   *  to `name` in the UI. */
  displayName?: string
  /** Optional manifest descriptions surfaced in the manager's
   *  details panel.  Subset of the `.stlib` manifest — only the
   *  fields the UI renders are pinned, so adding fields to the
   *  archive doesn't ripple through every consumer. */
  description?: string
  author?: string
}

/**
 * Result of a system-pool install attempt — both the .stlib and
 * .lib/.library paths funnel through this shape so the renderer
 * doesn't branch on origin.
 */
export type LibraryInstallResult =
  | {
      success: true
      /** True when the user closed the file picker without choosing
       *  a file.  The renderer treats this as a no-op (no toast, no
       *  error). */
      canceled?: false
      /** The installed library's identifier — caller can immediately
       *  pivot the manager UI to its details. */
      name: string
      version: string
      origin: 'stlib' | 'codesys'
    }
  | { success: true; canceled: true }
  | { success: false; error: string }
