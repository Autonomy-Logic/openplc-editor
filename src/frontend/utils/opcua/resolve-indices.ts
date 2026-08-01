/**
 * OPC-UA address resolver — variables → (arr, elem) lookups.
 *
 * Thin wrapper over the debugger's shared infrastructure:
 *
 *   - debug-parser.ts: buildLeafPathMap(debugMap) — uppercase-path →
 *     packed-DebugAddr lookup. The single source of truth for
 *     "variable path → address" resolution. The debugger's watch
 *     panel uses the exact same map.
 *   - debug-variable-finder.ts: buildDebugPath / buildGlobalDebugPath /
 *     findInstanceName — STruC++ path conventions.
 *   - debug-parser.ts: unpackDebugAddr — split the packed
 *     (arrayIdx<<16|elemIdx) integer back into explicit (arr, elem),
 *     which is the shape the runtime's strucpp_debug_* C entry
 *     points and the OPC-UA plugin's per-variable config consume.
 *
 * No OPC-UA-specific path construction, no parallel lookup table.
 * If the debugger can find a variable, OPC-UA can; if it can't,
 * neither can.
 */

import type { OpcUaFieldConfig, OpcUaNodeConfig } from '@root/middleware/shared/ports/open-plc-types'

import type { DebugLeafInfo } from '../debug-parser'
import {
  buildDebugPath,
  buildGlobalDebugPath,
  findInstanceName,
  type PLCInstanceMapping,
} from '../debug-variable-finder'
import type { PLCInstanceInfo, ResolvedField } from './types'

export interface LeafAddress {
  arr: number
  elem: number
  /** Canonical IEC type from the compiler's debug map (single source of
   *  truth — never the stored project-model datatype). */
  type: string
  /** Canonical byte width from the compiler's debug map. */
  size: number
}

export class OpcUaConfigError extends Error {
  constructor(
    public readonly variableRef: string,
    public readonly expectedPath: string,
    message: string,
  ) {
    super(message)
    this.name = 'OpcUaConfigError'
  }
}

const toInstanceMapping = (instances: PLCInstanceInfo[]): PLCInstanceMapping[] =>
  instances.map((inst) => ({ name: inst.name, program: inst.program }))

/**
 * Look up a STruC++ debug path in the shared leaf map and return the
 * (arr, elem) address. Returns null on miss. Wraps unpackDebugAddr.
 */
const lookup = (path: string, pathToAddr: Map<string, DebugLeafInfo>): LeafAddress | null => {
  const info = pathToAddr.get(path.toUpperCase())
  if (info === undefined) return null
  return { arr: info.arr, elem: info.elem, type: info.type, size: info.size }
}

/**
 * Build the full STruC++ debug path for a node — handling the
 * GVL/CONFIG (global) vs instance-prefixed cases. Returns null if
 * the program POU doesn't have an instance in Resources (the user
 * has to fix that themselves; not a leaf-level miss).
 */
const pathForNode = (
  pouName: string,
  variablePath: string,
  instances: PLCInstanceInfo[],
): { path: string } | { error: OpcUaConfigError } => {
  if (pouName === 'GVL' || pouName === 'CONFIG' || pouName.toUpperCase() === 'GVL') {
    return { path: buildGlobalDebugPath(variablePath) }
  }
  const instanceName = findInstanceName(pouName, toInstanceMapping(instances))
  if (!instanceName) {
    return {
      error: new OpcUaConfigError(
        pouName,
        'unknown',
        `Cannot find instance for program "${pouName}" in Resources.\n` +
          `  Make sure the program is instantiated in the Resources configuration.`,
      ),
    }
  }
  return { path: buildDebugPath(instanceName, variablePath) }
}

/**
 * Resolve the address for a simple variable node.
 *
 * @throws OpcUaConfigError if the variable cannot be resolved.
 */
export const resolveVariableAddress = (
  node: OpcUaNodeConfig,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): LeafAddress => {
  const result = pathForNode(node.pouName, node.variablePath, instances)
  if ('error' in result) throw result.error

  const addr = lookup(result.path, pathToAddr)
  if (addr) return addr

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    result.path,
    `Cannot resolve OPC-UA variable address.\n` +
      `  Variable: ${node.pouName}:${node.variablePath}\n` +
      `  Expected debug path: ${result.path}\n` +
      `  This may happen if the program was modified after configuring OPC-UA.`,
  )
}

/**
 * Resolve a single field, recursively handling nested fields.
 *
 * Returns null when the field path doesn't resolve in the debug map
 * (library-FB internals, renamed/deleted vars, etc.). Caller filters
 * the nulls and surfaces them as build warnings rather than aborting.
 *
 * `droppedPaths` is an out-param accumulating the unresolvable paths
 * for the build log to warn about.
 */
const resolveFieldRecursively = (
  field: OpcUaFieldConfig,
  parentPath: string,
  pouName: string,
  pathToAddr: Map<string, DebugLeafInfo>,
  instanceName: string | null,
  droppedPaths: string[],
): ResolvedField | null => {
  const fullFieldPath = `${parentPath}.${field.fieldPath}`

  // Complex field — recurse and filter out nulls. If every leaf
  // dropped, the parent has nothing meaningful to expose so it
  // collapses too.
  if (field.fields && field.fields.length > 0) {
    const nestedFields = field.fields
      .map((nestedField) =>
        resolveFieldRecursively(nestedField, fullFieldPath, pouName, pathToAddr, instanceName, droppedPaths),
      )
      .filter((f): f is ResolvedField => f !== null)

    if (nestedFields.length === 0) return null

    return {
      name: field.fieldPath,
      datatype: field.datatype || 'UNKNOWN',
      size: null,
      arr: null,
      elem: null,
      permissions: field.permissions,
      fields: nestedFields,
    }
  }

  // Leaf field. datatype/size come from the compiler's debug map (the
  // canonical source), not the stored field.datatype — the runtime
  // encodes/decodes this leaf by exactly these.
  const debugPath =
    pouName === 'GVL' || pouName === 'CONFIG'
      ? buildGlobalDebugPath(fullFieldPath)
      : buildDebugPath(instanceName!, fullFieldPath)
  const addr = lookup(debugPath, pathToAddr)
  if (!addr) {
    droppedPaths.push(`${pouName}:${fullFieldPath}`)
    return null
  }

  return {
    name: field.fieldPath,
    // Canonical type wins; fall back to the stored field datatype only if
    // the debug map somehow carries no type (malformed/old map).
    datatype: addr.type || field.datatype || 'UNKNOWN',
    size: addr.size,
    arr: addr.arr,
    elem: addr.elem,
    permissions: field.permissions,
  }
}

/**
 * Resolve addresses for all fields in a structure / FB / array.
 * Field-level resolution failures accumulate into `droppedPaths`.
 */
export const resolveStructureAddresses = (
  node: OpcUaNodeConfig,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
  droppedPaths: string[] = [],
): ResolvedField[] => {
  if (!node.fields || node.fields.length === 0) {
    const addr = resolveVariableAddress(node, pathToAddr, instances)
    return [
      {
        name: node.variablePath,
        datatype: addr.type,
        size: addr.size,
        arr: addr.arr,
        elem: addr.elem,
        permissions: node.permissions,
      },
    ]
  }

  let instanceName: string | null = null
  if (node.pouName !== 'GVL' && node.pouName !== 'CONFIG') {
    instanceName = findInstanceName(node.pouName, toInstanceMapping(instances))
    if (!instanceName) {
      throw new OpcUaConfigError(
        node.pouName,
        'unknown',
        `Cannot find instance for program "${node.pouName}" in Resources.`,
      )
    }
  }

  return node.fields
    .map((field) =>
      resolveFieldRecursively(field, node.variablePath, node.pouName, pathToAddr, instanceName, droppedPaths),
    )
    .filter((f): f is ResolvedField => f !== null)
}

/**
 * Resolve the starting address for an array. Returns the (arr, elem)
 * of the lowest-IEC-indexed element; subsequent elements live at
 * (arr, elem + i) within the same debug array (STruC++ guarantees
 * per-array contiguity).
 *
 * IEC arrays use arbitrary lower bounds (`ARRAY[1..N]`,
 * `ARRAY[-5..5]`) and STruC++ emits the IEC index in debug-map paths
 * — so the resolver scans the leaf map for the lowest-numbered
 * element matching the array's prefix rather than assuming `[0]`.
 */
export const resolveArrayAddress = (
  node: OpcUaNodeConfig,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): LeafAddress => {
  const result = pathForNode(node.pouName, node.variablePath, instances)
  if ('error' in result) throw result.error

  const upperPrefix = `${result.path.toUpperCase()}[`
  let best: { addr: LeafAddress; idx: number } | null = null
  for (const [path, info] of pathToAddr) {
    if (!path.startsWith(upperPrefix)) continue
    const close = path.indexOf(']', upperPrefix.length)
    // Reject array-of-struct sub-elements: `FOO[1].FIELD` matches
    // the prefix but is not the array's own leaf.
    if (close === -1 || close !== path.length - 1) continue
    const idx = Number(path.slice(upperPrefix.length, close))
    if (!Number.isFinite(idx)) continue
    if (best === null || idx < best.idx) {
      best = { addr: { arr: info.arr, elem: info.elem, type: info.type, size: info.size }, idx }
    }
  }
  if (best) return best.addr

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    `${result.path}[*]`,
    `Cannot resolve OPC-UA array address.\n` +
      `  Array: ${node.pouName}:${node.variablePath}\n` +
      `  Expected debug path: ${result.path}[<index>]\n` +
      `  No array elements with that prefix found in debug-map.json.`,
  )
}

/** One debug-map leaf below an array element, split into member segments. */
interface ElementLeaf {
  /** Member path under the element (`['A']`, `['INNER', 'B']`). */
  segments: string[]
  info: DebugLeafInfo
}

/**
 * Split the debug-map suffix that follows an array's base path into
 * segments, keeping index runs attached to the token they subscript:
 *
 *   `[1].A`        → ['[1]', 'A']
 *   `[1][2].A.B`   → ['[1][2]', 'A', 'B']
 *   `[3].INNER[0]` → ['[3]', 'INNER[0]']
 *
 * Dots only ever separate members (indices are numeric), so a plain
 * split is enough.
 */
const splitSuffixSegments = (suffix: string): string[] => suffix.split('.').filter((part) => part.length > 0)

/** Numeric sort key for an element token: `[1]` → [1], `[2][3]` → [2, 3]. */
const elementIndexKey = (elementToken: string): number[] =>
  [...elementToken.matchAll(/-?\d+/g)].map((match) => Number(match[0]))

/** Dimension-wise comparison so elements come out in IEC index order. */
const compareIndexKeys = (a: number[], b: number[]): number => {
  const width = Math.max(a.length, b.length)
  const perDimension = Array.from({ length: width }, (_, i) => (a[i] ?? 0) - (b[i] ?? 0))
  return perDimension.find((diff) => diff !== 0) ?? 0
}

/**
 * Group leaves into a field tree by their segment at `depth`. A group
 * whose own leaf exists at that depth is a leaf field (address from the
 * debug map); otherwise it is a container and recurses.
 */
const fieldsFromLeaves = (
  leaves: ElementLeaf[],
  depth: number,
  permissions: ResolvedField['permissions'],
): ResolvedField[] => {
  const groups = new Map<string, ElementLeaf[]>()
  for (const leaf of leaves) {
    const head = leaf.segments[depth]
    const bucket = groups.get(head)
    if (bucket) bucket.push(leaf)
    else groups.set(head, [leaf])
  }

  const fields: ResolvedField[] = []
  for (const [name, group] of groups) {
    const own = group.find((leaf) => leaf.segments.length === depth + 1)
    if (own) {
      fields.push({
        name,
        datatype: own.info.type || 'UNKNOWN',
        size: own.info.size,
        arr: own.info.arr,
        elem: own.info.elem,
        permissions,
      })
      continue
    }
    fields.push({
      name,
      // Container — the struct/FB type name isn't in the debug map and
      // the runtime only needs it for leaves (it creates an Object node).
      datatype: 'UNKNOWN',
      size: null,
      arr: null,
      elem: null,
      permissions,
      fields: fieldsFromLeaves(group, depth + 1, permissions),
    })
  }
  return fields
}

/**
 * Resolve an array whose elements are a derived type (UDT / FB instance)
 * into per-element structure fields, straight from the compiler's debug
 * map.
 *
 * Such an array has no leaf of its own — the debug map only carries
 * `ARR[i].FIELD` (and deeper) — so `resolveArrayAddress` cannot address
 * it by design. The variable picker pre-expands the elements into the
 * node's `fields` only when the array is 1-D and small enough
 * (MAX_ARRAY_EXPANSION), so bigger or multi-dimensional UDT arrays reach
 * the compiler as a bare `array` node with no fields. Rebuilding the
 * element fields from the debug map covers every case and keeps the
 * compiler as the single source of truth for type/size/address.
 *
 * Returns `[]` when the array has no sub-element leaves — i.e. a plain
 * array of base types, which `resolveArrayAddress` handles.
 */
export const resolveArrayElementFields = (
  node: OpcUaNodeConfig,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): ResolvedField[] => {
  const result = pathForNode(node.pouName, node.variablePath, instances)
  if ('error' in result) throw result.error

  const basePath = result.path.toUpperCase()
  const prefix = `${basePath}[`

  // element token → its leaves, in debug-map (memory layout) order
  const perElement = new Map<string, ElementLeaf[]>()
  for (const [path, info] of pathToAddr) {
    if (!path.startsWith(prefix)) continue
    const segments = splitSuffixSegments(path.slice(basePath.length))
    const memberSegments = segments.slice(1)
    // A bare `ARR[i]` leaf is a base-type element, not an array of UDT.
    if (memberSegments.length === 0) continue
    const elementToken = segments[0]
    const leaf: ElementLeaf = { segments: memberSegments, info }
    const bucket = perElement.get(elementToken)
    if (bucket) bucket.push(leaf)
    else perElement.set(elementToken, [leaf])
  }

  return [...perElement.entries()]
    .sort(([a], [b]) => compareIndexKeys(elementIndexKey(a), elementIndexKey(b)))
    .map(([elementToken, leaves]) => ({
      name: elementToken,
      datatype: node.elementType || 'UNKNOWN',
      size: null,
      arr: null,
      elem: null,
      permissions: node.permissions,
      fields: fieldsFromLeaves(leaves, 0, node.permissions),
    }))
}
