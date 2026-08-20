/**
 * Variables in a debug session: name → address, and bytes → value.
 *
 * Everything here is a thin arrangement of code the editor already runs. The
 * debug map is parsed by `debug-parser`, addresses are packed by
 * `packDebugAddr`, values are decoded by `parseValueByTypeName` and encoded by
 * `encodeForceValue`, and byte order is normalised by `applySwapToVariableBytes`.
 * Reimplementing any of those would mean the CLI could read a different value
 * from the same bytes than the watch panel does — which would make a passing
 * test meaningless.
 *
 * The decode loop mirrors `useDebugPolling`'s: the runtime replies with raw
 * type-sized values packed in request order, plus a `lastIndex` saying how far
 * it actually got. Trusting the request length instead of `lastIndex` is how
 * you end up reading the next variable's bytes as this one's value.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  buildLeafInfoMap,
  type DebugLeafInfo,
  type DebugMap,
  packDebugAddr,
  parseDebugMap,
} from '@root/frontend/utils/debug-parser'
import { walkDebugResponse } from '@root/frontend/utils/debug-response-walker'
import type { TargetEndian } from '@root/frontend/utils/endian'
import { encodeForceValue } from '@root/frontend/utils/variable-sizes'

import type { VariableValue } from '../session/protocol'

/** One resolved variable: its canonical path plus everything needed to talk about it. */
export interface ResolvedVariable extends DebugLeafInfo {
  /** Canonical path, in the casing `debug-map.json` declares. */
  name: string
  /** Packed (arr << 16 | elem) — the flat index the transports carry. */
  index: number
}

export interface DebugVariableIndex {
  /** MD5 of the compiled program this map belongs to. */
  md5: string
  /** Canonical order, as the compiler emitted it. */
  all: ResolvedVariable[]
  /** UPPERCASE path → variable. */
  byName: Map<string, ResolvedVariable>
  /** Packed index → variable, for decoding a reply. */
  byIndex: Map<number, ResolvedVariable>
}

/** Where the compiler leaves the debug map for a given target. */
export function debugMapPath(projectPath: string, boardTarget: string): string {
  return join(projectPath, 'build', boardTarget, 'src', 'debug-map.json')
}

export type LoadDebugIndexResult = { success: true; index: DebugVariableIndex } | { success: false; error: string }

/**
 * Read and index the debug map produced by the last compile for this target.
 *
 * A missing file is the normal "you have not compiled for this target yet"
 * case, and it is reported as such rather than as a parse failure — the two
 * have completely different fixes.
 */
export async function loadDebugIndex(projectPath: string, boardTarget: string): Promise<LoadDebugIndexResult> {
  const path = debugMapPath(projectPath, boardTarget)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return {
      success: false,
      error: `No debug map at ${path}. Compile this project for "${boardTarget}" first.`,
    }
  }
  const map = parseDebugMap(raw)
  if (!map) return { success: false, error: `Malformed or unsupported debug map at ${path}` }
  return { success: true, index: indexDebugMap(map) }
}

export function indexDebugMap(map: DebugMap): DebugVariableIndex {
  const leafInfo = buildLeafInfoMap(map)
  const all: ResolvedVariable[] = []
  const byName = new Map<string, ResolvedVariable>()
  const byIndex = new Map<number, ResolvedVariable>()

  for (const leaf of map.leaves) {
    const info = leafInfo.get(leaf.path.toUpperCase())
    /* istanbul ignore if -- buildLeafInfoMap is built from these same leaves */
    if (!info) continue
    const resolved: ResolvedVariable = {
      ...info,
      name: leaf.path,
      index: packDebugAddr({ arrayIdx: leaf.arrayIdx, elemIdx: leaf.elemIdx }),
    }
    all.push(resolved)
    // First declaration wins, matching `buildLeafPathMap`.
    if (!byName.has(leaf.path.toUpperCase())) byName.set(leaf.path.toUpperCase(), resolved)
    if (!byIndex.has(resolved.index)) byIndex.set(resolved.index, resolved)
  }

  return { md5: map.md5, all, byName, byIndex }
}

/**
 * Look a variable up the way a person types it: case-insensitively.
 *
 * IEC identifiers are case-insensitive, and a caller that has to match the
 * compiler's exact casing would be guessing.
 */
export function findVariable(index: DebugVariableIndex, name: string): ResolvedVariable | undefined {
  return index.byName.get(name.trim().toUpperCase())
}

/** Case-insensitive substring filter, preserving the compiler's order. */
export function filterVariables(index: DebugVariableIndex, filter: string | undefined): ResolvedVariable[] {
  if (!filter) return index.all
  const needle = filter.toUpperCase()
  return index.all.filter((variable) => variable.name.toUpperCase().includes(needle))
}

/**
 * Decode a `getVariablesList` reply into typed values.
 *
 * The positional walk is `walkDebugResponse`, shared with the GUI's
 * `useDebugPolling` — `lastIndex` handling, consumed-but-undecodable slots, the
 * short-buffer stop and the endian swap all mean the same thing here as they do
 * in the watch panel, because they are the same code. What is specific to this
 * caller is only the JSON typing of the value.
 */
export function decodeVariableValues(options: {
  requested: readonly ResolvedVariable[]
  payload: Uint8Array
  lastIndex: number | undefined
  endian: TargetEndian
  forced: ReadonlySet<string>
}): VariableValue[] {
  const { requested, payload, lastIndex, endian, forced } = options
  const byIndex = new Map(requested.map((variable) => [variable.index, variable]))
  const values: VariableValue[] = []

  walkDebugResponse({
    requested: requested.map((variable) => variable.index),
    payload,
    lastIndex,
    endian,
    typeOf: (index) => byIndex.get(index)?.type,
    emit: ({ index, type, value }) => {
      const variable = byIndex.get(index)
      /* istanbul ignore if -- typeOf resolved this index a moment ago */
      if (!variable) return
      values.push({
        name: variable.name,
        type,
        value: normaliseValue(value, type),
        forced: forced.has(variable.name.toUpperCase()),
      })
    },
    onError: ({ index, type }) => {
      const variable = byIndex.get(index)
      /* istanbul ignore if -- typeOf resolved this index a moment ago */
      if (!variable) return
      // `null` rather than a sentinel string: a caller checking the value must
      // not have to know that "ERR" means unreadable.
      values.push({ name: variable.name, type, value: null, forced: forced.has(variable.name.toUpperCase()) })
    },
  })

  return values
}

/**
 * Turn the codec's display string into a JSON-typed value.
 *
 * The codec returns strings for every type because the watch panel renders
 * text. A machine caller needs types: a BOOL should be `true`, not `"TRUE"`,
 * and an INT `42`, not `"42"`. 64-bit integers stay strings deliberately —
 * they do not survive an IEEE double, and silently losing precision on a LINT
 * is worse than making the caller parse a decimal string.
 */
export function normaliseValue(displayValue: string, typeName: string): boolean | number | string {
  const type = typeName.toUpperCase()
  if (type === 'BOOL') return displayValue === 'TRUE'
  if (type === 'LINT' || type === 'ULINT') return displayValue
  if (type === 'STRING' || type === 'WSTRING') {
    // The codec wraps strings in quotes for display; the value itself does not
    // include them.
    return displayValue.startsWith('"') && displayValue.endsWith('"') ? displayValue.slice(1, -1) : displayValue
  }
  if (INTEGER_TYPES.has(type) || FLOAT_TYPES.has(type)) {
    const parsed = Number(displayValue)
    return Number.isNaN(parsed) ? displayValue : parsed
  }
  // TIME / DATE / TOD / DT keep their formatted IEC literal — it is the useful
  // form, and re-deriving nanoseconds from it is lossy.
  return displayValue
}

const INTEGER_TYPES = new Set(['SINT', 'USINT', 'INT', 'UINT', 'DINT', 'UDINT', 'BYTE', 'WORD', 'DWORD', 'LWORD'])
const FLOAT_TYPES = new Set(['REAL', 'LREAL'])

/**
 * Encode a user-supplied value for a write or a force.
 *
 * Delegates to `encodeForceValue`, the same encoder the watch panel's force
 * dialog uses, so `16#FF`, `TRUE` and `T#5s` are accepted identically here and
 * in the GUI.
 */
export function encodeValue(
  variable: ResolvedVariable,
  input: string,
): { success: true; bytes: Uint8Array } | { success: false; error: string } {
  try {
    return { success: true, bytes: encodeForceValue(input, variable.type) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
