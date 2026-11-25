/**
 * Debug addresses of HMI tags in a compiled PLC program. The HMI generator names a tag by its instance path
 * (`CONFIG0.RES0.INSTANCE0.MAIN.LEVEL`, `CONFIG0.ALARMON`, `GVL.MEMBER`, `...M[2,1]`); the program's debug map names
 * the same variable without the configuration, resource or program type, and one subscript per dimension
 * (`INSTANCE0.LEVEL`, `ALARMON`, `GVL.MEMBER`, `...M[2][1]`).
 */
import type { HmiTagAddress } from '../unit/generate-hmi-unit'

/** A program instance of the configuration: `PROGRAM <name> WITH ... : <program>`. */
export interface HmiProgramInstance {
  name: string
  program: string
}

/** The configuration and resource every OpenPLC project compiles to, as instance paths spell them. */
const CONFIG_PREFIXES = ['CONFIG0.RES0.', 'CONFIG0.']

interface DebugLeaf {
  path: string
  arrayIdx: number
  elemIdx: number
}

const isDebugLeaf = (value: unknown): value is DebugLeaf =>
  typeof value === 'object' &&
  value !== null &&
  'path' in value &&
  typeof value.path === 'string' &&
  'arrayIdx' in value &&
  Number.isInteger(value.arrayIdx) &&
  'elemIdx' in value &&
  Number.isInteger(value.elemIdx)

/** The leaves of a debug-map.json; empty when the text is not one. */
function debugLeaves(debugMapJson: string): DebugLeaf[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(debugMapJson)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || !('leaves' in parsed) || !Array.isArray(parsed.leaves)) return []
  const leaves: unknown[] = parsed.leaves
  return leaves.filter(isDebugLeaf)
}

/** A tag path as the debug map spells it: upper case, without the configuration, resource or program type. */
export function hmiDebugPath(path: string, instances: readonly HmiProgramInstance[]): string {
  let p = path
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/\[([^\]]*,[^\]]*)\]/g, (_whole, indices: string) =>
      indices
        .split(',')
        .map((index) => `[${index}]`)
        .join(''),
    )
  const prefix = CONFIG_PREFIXES.find((candidate) => p.startsWith(candidate))
  if (prefix) p = p.slice(prefix.length)
  const parts = p.split('.')
  if (parts.length >= 3) {
    const instance = instances.find((i) => i.name.toUpperCase() === parts[0])
    if (instance && instance.program.toUpperCase() === parts[1]) p = [parts[0], ...parts.slice(2)].join('.')
  }
  return p
}

/** Resolves a tag path to its debug address in the program whose debug map is `debugMapJson`; null when absent. */
export function hmiTagResolver(
  debugMapJson: string,
  instances: readonly HmiProgramInstance[],
): (path: string) => HmiTagAddress | null {
  const byPath = new Map<string, HmiTagAddress>()
  for (const leaf of debugLeaves(debugMapJson))
    byPath.set(leaf.path.toUpperCase(), { arr: leaf.arrayIdx, elem: leaf.elemIdx })
  return (path) => byPath.get(hmiDebugPath(path, instances)) ?? null
}
