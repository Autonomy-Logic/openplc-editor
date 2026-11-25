/**
 * Request and result of the in-editor WebAssembly toolchain, as callers and platform boundaries see them.
 */

/** Files keyed by relative path (`dir/file.cpp`), as text or bytes. */
export type WasmToolchainFiles = Record<string, string | Uint8Array>

export type WasmUnitLanguage = 'c' | 'c++'

/** Kinds of build a library's compiled object is kept next to the library for; each kind is its own file. */
export const WASM_LIBRARY_OBJECT_KINDS = ['hmi', 'hmi-factory', 'simulator'] as const
export type WasmLibraryObjectKind = (typeof WASM_LIBRARY_OBJECT_KINDS)[number]

/** A unit that is a library's own code: its object is also kept next to the library, under `key`. */
export interface WasmLibraryObjectTag {
  /** The library's name, as its manifest gives it. */
  name: string
  kind: WasmLibraryObjectKind
  /** Digest of what the object is built from besides its sources (`libraryObjectKey`). */
  key: string
}

/** One translation unit: a file in `files` compiled to one object. */
export interface WasmCompileUnit {
  source: string
  language: WasmUnitLanguage
  /** Flags for this unit only, after the language flags. */
  flags?: string[]
  /** When true, `flags` replace the request's language flags, so the unit compiles alike in every request. */
  ownFlags?: boolean
  /** Set when the unit is a library's own code, whose object is kept next to the library. */
  library?: WasmLibraryObjectTag
}

export interface WasmCompileRequest {
  /** Sources, headers and any other input, keyed by relative path. */
  files: WasmToolchainFiles
  units: WasmCompileUnit[]
  /** Flags for every C unit. */
  cFlags?: string[]
  /** Flags for every C++ unit. */
  cxxFlags?: string[]
  /** Flags for the link step, for example `-mexec-model=reactor`. */
  linkFlags?: string[]
  /** Path of the linked module. Defaults to `module.wasm`. */
  output?: string
}

/** The units of a build and how many of their objects came from the cache. */
export interface WasmCompileStats {
  units: number
  cached: number
}

/** One line of compiler output, or a message about the build itself. */
export interface WasmDiagnostic {
  message: string
  level: 'warning' | 'error'
}

export type WasmCompileResult =
  | { ok: true; wasm: Uint8Array; stats: WasmCompileStats; diagnostics: WasmDiagnostic[] }
  | { ok: false; error: string; stats: WasmCompileStats; diagnostics: WasmDiagnostic[] }
