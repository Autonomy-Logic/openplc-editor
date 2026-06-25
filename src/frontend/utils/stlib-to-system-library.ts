/**
 * Map a strucpp `.stlib` archive into the editor's `SystemLibrary` shape.
 *
 * `.stlib` archives carry IEC 61131-3 library metadata in a compact,
 * compiler-oriented form (manifest + sources + codegen). The editor's
 * library tree, by contrast, expects each library as a flat list of
 * `SystemLibraryPou` entries with input/output/local variables and a
 * single concrete or generic type per pin. This module is the boundary:
 * it walks one manifest and produces one `SystemLibrary` ready for
 * dispatch into the Zustand library slice.
 *
 * Type encoding:
 *   - Concrete IEC types (`INT`, `BOOL`, `REAL`, …) become
 *     `{ definition: 'base-type', value }`.
 *   - Generic markers (`ANY`, `ANY_NUM`, `ANY_INT`, `ANY_REAL`, `ANY_BIT`,
 *     `ANY_STRING`, `ANY_ELEMENTARY`, `ANY_DATE`, `ANY_CHAR`, `ANY_CHARS`,
 *     `ANY_INTEGRAL`, `ANY_SIGNED`, `ANY_UNSIGNED`, `ANY_MAGNITUDE`)
 *     become `{ definition: 'generic-type', value }`. Tooling unifies
 *     identical generic names across params and the return type at
 *     instantiation — see strucpp's library-manifest docstring.
 *   - Anything else falls through as `'derived-type'`. In practice the
 *     bundled libs only mix concrete + generic, but the fallback keeps
 *     user-installed .stlibs (future library manager) working when they
 *     reference local STRUCT/ENUM names.
 *
 * Function shape:
 *   `.stlib` functions carry `parameters[]` + `returnType`. We synthesize
 *   a synthetic `OUT` output variable from `returnType` so consumers
 *   can render functions like ADD with two input pins and one output
 *   pin without special-casing function vs. function-block. The
 *   `variadic` flag flows through as `extensible: true` for the same
 *   reason — block-rendering code already understands extensible.
 *
 * Function-block shape:
 *   inputs/outputs/inouts arrays in `.stlib` map directly. `inout`
 *   parameters become class `'inOut'` (camel-case the editor uses).
 */

import type { StlibArchiveDTO } from '../../middleware/shared/ports/library-port'
import type {
  SystemLibrary,
  SystemLibraryPou,
  SystemLibraryVariable,
} from '../../middleware/shared/ports/library-types'

const GENERIC_TYPE_NAMES = new Set([
  'ANY',
  'ANY_NUM',
  'ANY_INT',
  'ANY_REAL',
  'ANY_BIT',
  'ANY_STRING',
  'ANY_ELEMENTARY',
  'ANY_DATE',
  'ANY_CHAR',
  'ANY_CHARS',
  'ANY_INTEGRAL',
  'ANY_SIGNED',
  'ANY_UNSIGNED',
  'ANY_MAGNITUDE',
])

const BASE_TYPE_NAMES = new Set([
  'BOOL',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  '__XWORD',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'WSTRING',
])

function typeRef(typeName: string): SystemLibraryVariable['type'] {
  if (GENERIC_TYPE_NAMES.has(typeName)) {
    return { definition: 'generic-type', value: typeName }
  }
  if (BASE_TYPE_NAMES.has(typeName)) {
    return { definition: 'base-type', value: typeName }
  }
  return { definition: 'derived-type', value: typeName }
}

function classFromDirection(d: 'input' | 'output' | 'inout'): SystemLibraryVariable['class'] {
  if (d === 'inout') return 'inOut'
  return d
}

export function stlibToSystemLibrary(archive: StlibArchiveDTO): SystemLibrary {
  const m = archive.manifest
  const pous: SystemLibraryPou[] = []

  for (const fn of m.functions) {
    const variables: SystemLibraryVariable[] = [
      ...fn.parameters.map((p) => ({
        name: p.name,
        class: classFromDirection(p.direction),
        type: typeRef(p.type),
      })),
      // Functions return a single value; surface it as a synthetic OUT
      // pin so block-rendering treats functions and FBs uniformly.
      { name: 'OUT', class: 'output' as const, type: typeRef(fn.returnType) },
    ]
    pous.push({
      name: fn.name,
      type: 'function',
      language: 'st',
      variables,
      body: '',
      documentation: fn.documentation ?? '',
      extensible: fn.variadic !== undefined,
      category: fn.category,
    })
  }

  for (const fb of m.functionBlocks) {
    const variables: SystemLibraryVariable[] = [
      ...fb.inputs.map((v) => ({
        name: v.name,
        class: 'input' as const,
        type: typeRef(v.type),
      })),
      ...fb.outputs.map((v) => ({
        name: v.name,
        class: 'output' as const,
        type: typeRef(v.type),
      })),
      ...fb.inouts.map((v) => ({
        name: v.name,
        class: 'inOut' as const,
        type: typeRef(v.type),
      })),
    ]
    pous.push({
      name: fb.name,
      type: 'function-block',
      language: 'st',
      variables,
      body: '',
      documentation: fb.documentation ?? '',
      category: fb.category,
    })
  }

  // C/C++ function blocks carried verbatim in `archive.cppBlocks`
  // (strucpp doesn't compile these — the consumer's program build
  // grafts them into its own C++-POU pipeline).  Each block is
  // surfaced under the library-prefixed name (`<library>__<name>`)
  // that the consumer's source code must reference, since the
  // injection step at compile time uses the same prefix.  The
  // picker shows the prefix so the user types the right name; the
  // injection produces a POU with that exact name; everything
  // resolves cleanly.
  type CppBlockVar = {
    name: string
    class?: string
    type?: { value?: string }
    documentation?: string
  }
  type CppBlockEntry = {
    name: string
    code: string
    variables: CppBlockVar[]
    documentation?: string
  }
  const archiveWithCppBlocks = archive as typeof archive & { cppBlocks?: CppBlockEntry[] }
  for (const block of archiveWithCppBlocks.cppBlocks ?? []) {
    const variables: SystemLibraryVariable[] = []
    for (const v of block.variables) {
      if (v.class !== 'input' && v.class !== 'output' && v.class !== 'inOut') continue
      variables.push({
        name: v.name,
        class: v.class,
        type: typeRef(v.type?.value ?? 'BOOL'),
      })
    }
    pous.push({
      name: `${m.name}__${block.name}`,
      type: 'function-block',
      language: 'cpp',
      variables,
      body: block.code,
      documentation: block.documentation ?? '',
    })
  }

  const result: SystemLibrary = {
    name: m.name,
    author: '',
    version: m.version,
    stPath: '',
    cPath: '',
    pous,
  }
  if (m.displayName) result.displayName = m.displayName
  return result
}

export function stlibsToSystemLibraries(archives: StlibArchiveDTO[]): SystemLibrary[] {
  return archives.map(stlibToSystemLibrary)
}
