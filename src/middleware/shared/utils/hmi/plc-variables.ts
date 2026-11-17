/**
 * The PLC variables screens may use, named as screens write them: `<Instance>.<Program>.<Name>`, configuration
 * globals by name and `<List>.<Name>`, then the inputs and outputs of function block instances, struct fields and
 * the elements of one-dimensional arrays below them (`T1.Q`, `P.X`, `Arr[3]`); elementary types only, constants
 * marked read-only.
 */
import type { HmiLibraryArchive, HmiPlcVariable } from '../../ports/hmi-preview-types'
import type { PLCDataType, PLCPou, PLCProjectData, PLCVariable, PLCVariableType } from '../../ports/types'

const HIDDEN_CLASSES = new Set(['temp', 'external'])
/** Elements listed per array; larger arrays list their first ones only. */
export const HMI_ARRAY_ELEMENTS_MAX = 32
/** How deep function blocks and structs are followed. */
export const HMI_NESTING_MAX = 6
/** Elementary types, as library manifests spell them. */
const ELEMENTARY = new Set([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
  'TIME',
  'LTIME',
  'DATE',
  'TOD',
  'TIME_OF_DAY',
  'DT',
  'DATE_AND_TIME',
  'STRING',
  'WSTRING',
])

const isElementary = (type: string): boolean => {
  const t = type.trim().toUpperCase()
  return ELEMENTARY.has(t) || /^W?STRING\s*[([]\s*\d+\s*[)\]]$/.test(t)
}

/** The elementary type a variable type names, upper case: a base type or a sized string such as `STRING(20)`. */
function elementaryOf(type: PLCVariableType): string | null {
  if (type.definition === 'base-type') return type.value.toUpperCase()
  if (type.definition !== 'array' && isElementary(type.value)) return type.value.trim().toUpperCase()
  return null
}

/** A function block's pins a screen may read: its inputs and outputs, by name and type. */
export interface HmiBlockPins {
  inputs: ReadonlyArray<{ name: string; type: string }>
  outputs: ReadonlyArray<{ name: string; type: string }>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function pinsOf(value: unknown): Array<{ name: string; type: string }> {
  if (!Array.isArray(value)) return []
  const items: unknown[] = value
  return items.flatMap((item) =>
    isRecord(item) && typeof item.name === 'string' && typeof item.type === 'string'
      ? [{ name: typeof item.displayName === 'string' ? item.displayName : item.name, type: item.type }]
      : [],
  )
}

/** The function blocks of the PLC's libraries with their pins, by upper-case name; archives that do not read are skipped. */
export function hmiLibraryBlocks(archives: readonly HmiLibraryArchive[]): Map<string, HmiBlockPins> {
  const loaded: unknown[] = []
  for (const archive of archives) {
    try {
      loaded.push(JSON.parse(archive.archiveJson))
    } catch {
      continue
    }
  }
  return hmiLibraryBlocksOfArchives(loaded)
}

/** The function blocks of loaded `.stlib` archives (objects with a `manifest`) with their pins, by upper-case name. */
export function hmiLibraryBlocksOfArchives(archives: readonly unknown[]): Map<string, HmiBlockPins> {
  const blocks = new Map<string, HmiBlockPins>()
  for (const archive of archives) {
    const manifest = isRecord(archive) && isRecord(archive.manifest) ? archive.manifest : undefined
    const fbs: unknown = manifest?.functionBlocks
    if (!Array.isArray(fbs)) continue
    const entries: unknown[] = fbs
    for (const fb of entries) {
      if (!isRecord(fb) || typeof fb.name !== 'string') continue
      blocks.set(fb.name.toUpperCase(), { inputs: pinsOf(fb.inputs), outputs: pinsOf(fb.outputs) })
    }
  }
  return blocks
}

/** Index bounds of each dimension of an array, or null when any bound is not an integer literal. */
function bounds(dimensions: ReadonlyArray<{ dimension: string }>): Array<[number, number]> | null {
  if (dimensions.length === 0) return null
  const ranges: Array<[number, number]> = []
  for (const { dimension } of dimensions) {
    const m = /^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/.exec(dimension)
    if (!m) return null
    const lo = Number(m[1])
    const hi = Number(m[2])
    if (hi < lo) return null
    ranges.push([lo, hi])
  }
  return ranges
}

/** The index tuples of an array in row-major order, the first `max` of them. */
function indexTuples(ranges: ReadonlyArray<[number, number]>, max: number): number[][] {
  const tuples: number[][] = []
  const walk = (prefix: number[]): void => {
    if (tuples.length >= max) return
    if (prefix.length === ranges.length) {
      tuples.push(prefix)
      return
    }
    const [lo, hi] = ranges[prefix.length]
    for (let i = lo; i <= hi && tuples.length < max; i++) walk([...prefix, i])
  }
  walk([])
  return tuples
}

interface Lookup {
  dataTypes: ReadonlyMap<string, PLCDataType>
  blocks: ReadonlyMap<string, PLCPou>
  library: ReadonlyMap<string, HmiBlockPins>
}

/** Takes a leaf: its path, type and whether it is a block output or below one. */
type Emit = (path: string, type: string, output: boolean) => void

/** The leaves under a value of a named type: struct fields, block pins or array elements; none for other types. */
function expandNamed(
  path: string,
  name: string,
  at: Lookup,
  emit: Emit,
  seen: readonly string[],
  output = false,
): void {
  const key = name.trim().toUpperCase()
  if (seen.length >= HMI_NESTING_MAX || seen.includes(key)) return
  const inner = [...seen, key]
  const dt = at.dataTypes.get(key)
  if (dt?.derivation === 'structure') {
    for (const field of dt.variable) expandType(`${path}.${field.name}`, field.type, at, emit, inner, output)
    return
  }
  if (dt?.derivation === 'array') {
    expandArray(path, dt.baseType, dt.dimensions, at, emit, inner, output)
    return
  }
  const pou = at.blocks.get(key)
  if (pou) {
    for (const v of pou.interface?.variables ?? [])
      if (v.class === 'input' || v.class === 'output')
        expandType(`${path}.${v.name}`, v.type, at, emit, inner, output || v.class === 'output')
    return
  }
  const pins = at.library.get(key)
  if (pins)
    for (const [list, isOutput] of [
      [pins.inputs, false],
      [pins.outputs, true],
    ] as const)
      for (const pin of list) {
        if (isElementary(pin.type)) emit(`${path}.${pin.name}`, pin.type.toUpperCase(), output || isOutput)
        else expandNamed(`${path}.${pin.name}`, pin.type, at, emit, inner, output || isOutput)
      }
}

function expandArray(
  path: string,
  element: PLCVariableType | { definition: 'base-type' | 'user-data-type'; value: string },
  dimensions: ReadonlyArray<{ dimension: string }>,
  at: Lookup,
  emit: Emit,
  seen: readonly string[],
  output = false,
): void {
  const ranges = bounds(dimensions)
  if (!ranges) return
  for (const tuple of indexTuples(ranges, HMI_ARRAY_ELEMENTS_MAX)) {
    const item = `${path}[${tuple.join(',')}]`
    if (element.definition === 'base-type') emit(item, element.value.toUpperCase(), output)
    else expandNamed(item, element.value, at, emit, seen, output)
  }
}

function expandType(
  path: string,
  type: PLCVariableType,
  at: Lookup,
  emit: Emit,
  seen: readonly string[],
  output = false,
): void {
  const elementary = elementaryOf(type)
  if (elementary !== null) emit(path, elementary, output)
  else if (type.definition === 'array') {
    if (type.data) expandArray(path, type.data.baseType, type.data.dimensions, at, emit, seen, output)
  } else expandNamed(path, type.value, at, emit, seen, output)
}

/**
 * The variables screens may use. `libraryBlocks` gives the pins of library function blocks (`hmiLibraryBlocks`);
 * without it, instances of library blocks list nothing below them.
 */
export function hmiPlcVariables(
  project: Pick<PLCProjectData, 'pous' | 'configurations'> &
    Partial<Pick<PLCProjectData, 'globalVariableLists' | 'dataTypes'>>,
  libraryBlocks: ReadonlyMap<string, HmiBlockPins> = new Map(),
): HmiPlcVariable[] {
  const at: Lookup = {
    dataTypes: new Map((project.dataTypes ?? []).map((d) => [d.name.toUpperCase(), d])),
    blocks: new Map(project.pous.filter((p) => p.pouType === 'function-block').map((p) => [p.name.toUpperCase(), p])),
    library: libraryBlocks,
  }
  const variables: HmiPlcVariable[] = []
  const add = (path: string, v: PLCVariable, global = false) => {
    if (v.class !== undefined && HIDDEN_CLASSES.has(v.class)) return
    const marks = {
      ...(v.flag === 'constant' ? { constant: true as const } : {}),
      ...(global ? { scope: 'global' as const } : {}),
    }
    const elementary = elementaryOf(v.type)
    if (elementary !== null) {
      const initial = v.initialValue?.trim()
      variables.push({
        path,
        type: elementary,
        ...(initial ? { initialValue: initial } : {}),
        ...marks,
      })
      return
    }
    expandType(
      path,
      v.type,
      at,
      (leaf, type, output) =>
        variables.push({ path: leaf, type, ...marks, ...(output ? { blockOutput: true as const } : {}) }),
      [],
    )
  }
  const { resource } = project.configurations
  for (const instance of resource.instances) {
    const pou = project.pous.find(
      (p) => p.pouType === 'program' && p.name.toUpperCase() === instance.program.toUpperCase(),
    )
    if (!pou) continue
    for (const v of pou.interface?.variables ?? []) add(`${instance.name}.${pou.name}.${v.name}`, v)
  }
  for (const v of resource.globalVariables) add(v.name, v, true)
  for (const list of project.globalVariableLists ?? []) for (const v of list.variables) add(`${list.name}.${v.name}`, v)
  return variables
}

/** A branch or leaf of the designer's variable tree. */
export interface HmiVariableNode {
  /** The path prefix a branch stands for, or the variable's path for a leaf; the globals branch is `#globals`. */
  key: string
  label: string
  children: HmiVariableNode[]
  variable?: HmiPlcVariable
}

/** Key of the branch that holds the configuration globals. */
export const HMI_GLOBALS_NODE = '#globals'

/**
 * The variables as a tree by their paths' parts: instances, programs, Global Variable Lists, block instances, structs
 * and arrays (`[i]` parts); configuration globals, with what is below them, under one Globals branch. First seen,
 * first.
 */
export function hmiVariableTree(variables: readonly HmiPlcVariable[]): HmiVariableNode[] {
  const roots: HmiVariableNode[] = []
  const globals: HmiVariableNode = { key: HMI_GLOBALS_NODE, label: 'Globals', children: [] }
  for (const variable of variables) {
    const parts = pathParts(variable.path)
    let level = roots
    if (variable.scope === 'global' || parts.length === 1) {
      if (!roots.includes(globals)) roots.push(globals)
      level = globals.children
    }
    for (const part of parts.slice(0, -1)) {
      let node = level.find((n) => n.variable === undefined && n.key.toUpperCase() === part.key.toUpperCase())
      if (!node) {
        node = { key: part.key, label: part.label, children: [] }
        level.push(node)
      }
      level = node.children
    }
    const leaf = parts[parts.length - 1]
    level.push({ key: variable.path, label: leaf.label, children: [], variable })
  }
  return roots
}

/** A path's parts: names between dots and `[i]` subscripts, each with the path up to it as its key. */
function pathParts(path: string): Array<{ key: string; label: string }> {
  const parts: Array<{ key: string; label: string }> = []
  for (const m of path.matchAll(/\[[^\]]*\]|[^.[\]]+/g)) {
    const end = (m.index ?? 0) + m[0].length
    parts.push({ key: path.slice(0, end), label: m[0] })
  }
  return parts
}

/** The tree with only the variables whose path holds `filter`, ignoring case, and the branches leading to them. */
export function filterHmiVariableTree(nodes: readonly HmiVariableNode[], filter: string): HmiVariableNode[] {
  const wanted = filter.toUpperCase()
  return nodes.flatMap((node) => {
    if (node.variable) return node.variable.path.toUpperCase().includes(wanted) ? [node] : []
    const children = filterHmiVariableTree(node.children, filter)
    return children.length > 0 ? [{ ...node, children }] : []
  })
}
