import {
  compileToWasm,
  type WasmCompileOptions,
  type WasmCompileRequest,
  type WasmCompileResult,
  type WasmCompileUnit,
} from './compile-to-wasm'
import type { WasmToolchainFiles } from './file-tree'

/** Where the STruC++ runtime headers are placed in the toolchain's working directory. */
export const STRUCPP_RUNTIME_INCLUDE_DIR = 'strucpp_runtime/include'
/** Where the C++ files STruC++ generated are placed. */
export const STRUCPP_OUTPUT_DIR = 'strucpp'

/** The C++ dialect STruC++ generates for. */
export const STRUCPP_CXX_FLAGS = ['-std=gnu++17']

export interface StrucppWasmRequest {
  /** The files STruC++ produced (`generated.cpp`, `generated.hpp`, ...), keyed by file name. */
  strucppFiles: Record<string, string>
  /** The STruC++ runtime headers (`iec_std_lib.hpp`, ...), keyed by file name. */
  runtimeHeaders: Record<string, string>
  /** Other inputs the caller compiles in, such as a host or a core library, keyed by relative path. */
  extraFiles?: WasmToolchainFiles
  /** Translation units among `extraFiles`. */
  extraUnits?: WasmCompileUnit[]
  cFlags?: string[]
  /** Flags for every C++ unit, after the STruC++ dialect and include paths. */
  cxxFlags?: string[]
  linkFlags?: string[]
  output?: string
}

const isCppSource = (name: string): boolean => /\.(cpp|cc|cxx)$/.test(name)

/** Lays out STruC++ output, its runtime headers and the caller's extra inputs as one compile request. */
export function buildStrucppWasmRequest(request: StrucppWasmRequest): WasmCompileRequest {
  const files: WasmToolchainFiles = {}
  for (const [name, content] of Object.entries(request.runtimeHeaders)) {
    files[`${STRUCPP_RUNTIME_INCLUDE_DIR}/${name}`] = content
  }
  const generatedUnits: WasmCompileUnit[] = []
  for (const name of Object.keys(request.strucppFiles).sort()) {
    const path = `${STRUCPP_OUTPUT_DIR}/${name}`
    files[path] = request.strucppFiles[name]
    if (isCppSource(name)) generatedUnits.push({ source: path, language: 'c++' })
  }
  for (const [path, content] of Object.entries(request.extraFiles ?? {})) {
    if (files[path] !== undefined) throw new Error(`Extra file '${path}' collides with a STruC++ file`)
    files[path] = content
  }
  return {
    files,
    units: [...generatedUnits, ...(request.extraUnits ?? [])],
    cFlags: request.cFlags,
    cxxFlags: [
      ...STRUCPP_CXX_FLAGS,
      `-I${STRUCPP_RUNTIME_INCLUDE_DIR}`,
      `-I${STRUCPP_OUTPUT_DIR}`,
      ...(request.cxxFlags ?? []),
    ],
    linkFlags: request.linkFlags,
    output: request.output,
  }
}

/** Compiles STruC++ output, with its runtime headers and the caller's extra units, into one WebAssembly module. */
export async function compileStrucppToWasm(
  request: StrucppWasmRequest,
  options: WasmCompileOptions,
): Promise<WasmCompileResult> {
  let compileRequest: WasmCompileRequest
  try {
    compileRequest = buildStrucppWasmRequest(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.log?.(message, 'error')
    return {
      ok: false,
      error: message,
      stats: { units: 0, cached: 0, compileMs: 0, linkMs: 0 },
      diagnostics: [{ message, level: 'error' }],
    }
  }
  return compileToWasm(compileRequest, options)
}
