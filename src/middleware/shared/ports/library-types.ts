export type LibraryPouType = 'function' | 'function-block'
export type LibraryLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd'

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
