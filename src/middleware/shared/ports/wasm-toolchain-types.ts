/**
 * Request and result of the in-editor WebAssembly toolchain, as callers and platform boundaries see them.
 */

/** Files keyed by relative path (`dir/file.cpp`), as text or bytes. */
export type WasmToolchainFiles = Record<string, string | Uint8Array>

export type WasmUnitLanguage = 'c' | 'c++'

/** One translation unit: a file in `files` compiled to one object. */
export interface WasmCompileUnit {
  source: string
  language: WasmUnitLanguage
  /** Flags for this unit only, after the language flags. */
  flags?: string[]
  /** Header of one of the request's `precompiledHeaders` that this unit includes precompiled, ahead of its source. */
  pch?: string
}

/** A header compiled once into a precompiled header; units name it with `pch`. Its flags must match theirs. */
export interface WasmPrecompiledHeader {
  header: string
  language: WasmUnitLanguage
  /** Flags for this header only, after the language flags. */
  flags?: string[]
}

export interface WasmCompileRequest {
  /** Sources, headers and any other input, keyed by relative path. */
  files: WasmToolchainFiles
  units: WasmCompileUnit[]
  /** Headers compiled before the units, for units that name them with `pch`. */
  precompiledHeaders?: WasmPrecompiledHeader[]
  /** Flags for every C unit. */
  cFlags?: string[]
  /** Flags for every C++ unit. */
  cxxFlags?: string[]
  /** Flags for the link step, for example `-mexec-model=reactor`. */
  linkFlags?: string[]
  /** Path of the linked module. Defaults to `module.wasm`. */
  output?: string
}

export interface WasmCompileStats {
  units: number
  cached: number
  compileMs: number
  linkMs: number
}

/** One line of compiler output, or a message about the build itself. */
export interface WasmDiagnostic {
  message: string
  level: 'warning' | 'error'
}

export type WasmCompileResult =
  | { ok: true; wasm: Uint8Array; stats: WasmCompileStats; diagnostics: WasmDiagnostic[] }
  | { ok: false; error: string; stats: WasmCompileStats; diagnostics: WasmDiagnostic[] }
