import type { PLCDataType, PLCGlobalVariableList, PLCPou, PLCVariable } from '../../../../middleware/shared/ports/types'
import { GLOBAL_CONFIG_NAME } from '../../debug-variable-finder'
import { globalVariableListTypeName } from '../../PLC/global-variable-list-serializer'
import {
  isMqttIecType,
  MQTT_DEBUG_SIZE,
  MQTT_LIMITS,
  type MqttIecType,
  type MqttSourceToken,
} from '../contract/contract'

/** Configuration name the ST transpiler emits; source tokens of a global variable start with it. */
export const MQTT_GLOBAL_SCOPE_NAME = GLOBAL_CONFIG_NAME

export interface MqttModelTypeRef {
  definition: string
  value: string
  data?: {
    baseType: { definition: string; value: string }
    dimensions: ReadonlyArray<{ dimension: string }>
  }
}

export interface MqttModelVariable {
  name: string
  class?: string
  type: MqttModelTypeRef
}

export type MqttModelDataType =
  | { name: string; derivation: 'structure'; variable: readonly MqttModelVariable[] }
  | { name: string; derivation: 'enumerated' }
  | {
      name: string
      derivation: 'array'
      baseType: { definition: string; value: string }
      dimensions: ReadonlyArray<{ dimension: string }>
    }

export interface MqttModelPou {
  name: string
  kind: 'program' | 'function-block'
  variables: readonly MqttModelVariable[]
}

/** Platform-neutral view of what the program declares, used to build and check MQTT source references. */
export interface MqttSourceModel {
  instances: ReadonlyArray<{ name: string; program: string }>
  pous: readonly MqttModelPou[]
  dataTypes: readonly MqttModelDataType[]
  globalVariables: readonly MqttModelVariable[]
  /** Public interface of library function blocks; undefined when the loaded libraries are unknown. */
  libraryFunctionBlocks?: readonly MqttModelPou[]
}

export type MqttUnsupportedReason =
  | 'type_enumeration'
  | 'type_unsupported'
  | 'type_unknown'
  | 'type_recursive'
  | 'array_bounds_invalid'
  | 'array_rank_too_high'
  | 'path_too_deep'

export type MqttMissingReason =
  | 'token_shape'
  | 'identifier_invalid'
  | 'instance_missing'
  | 'program_mismatch'
  | 'program_missing'
  | 'member_missing'
  | 'not_an_array'
  | 'index_rank_mismatch'
  | 'index_out_of_range'
  | 'not_a_composite'

export type MqttSourceDescription =
  | { status: 'leaf'; iecType: MqttIecType; size: number }
  | { status: 'container' }
  | { status: 'opaque'; typeName: string }
  | { status: 'unsupported'; reason: MqttUnsupportedReason; typeName: string }
  | { status: 'missing'; reason: MqttMissingReason }

export interface MqttArrayDimension {
  lower: number
  upper: number
}

interface MqttTreeNodeBase {
  /** Stable key of the source tokens. */
  id: string
  label: string
  tokens: MqttSourceToken[]
}

export type MqttTreeNode =
  | (MqttTreeNodeBase & { kind: 'scope'; scope: 'instance' | 'global'; program?: string; children: MqttTreeNode[] })
  | (MqttTreeNodeBase & { kind: 'composite'; typeName: string; children: MqttTreeNode[] })
  | (MqttTreeNodeBase & {
      kind: 'array'
      typeName: string
      dimensions: MqttArrayDimension[]
      elementCount: number
      element: MqttModelTypeRef
    })
  | (MqttTreeNodeBase & { kind: 'leaf'; iecType: MqttIecType; size: number })
  | (MqttTreeNodeBase & { kind: 'opaque'; typeName: string })
  | (MqttTreeNodeBase & { kind: 'unsupported'; typeName: string; reason: MqttUnsupportedReason })

type ResolvedType =
  | { kind: 'leaf'; iecType: MqttIecType }
  | { kind: 'array'; typeName: string; dimensions: MqttArrayDimension[]; element: MqttModelTypeRef }
  | { kind: 'composite'; typeName: string; members: readonly MqttModelVariable[] }
  | { kind: 'opaque'; typeName: string }
  | { kind: 'unsupported'; typeName: string; reason: MqttUnsupportedReason }

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const DIMENSION = /^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const TYPE_ALIASES: Readonly<Record<string, string>> = { TIME_OF_DAY: 'TOD', DATE_AND_TIME: 'DT' }
const PERSISTENT_MEMBER_CLASSES: ReadonlySet<string> = new Set(['input', 'output', 'inOut', 'local'])
const LIBRARY_INTERFACE_CLASSES: ReadonlySet<string> = new Set(['input', 'output', 'inOut'])

const sameName = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

export const isMqttIdentifier = (name: string): boolean => IDENTIFIER.test(name)

/** Exact, order-preserving key of a source path. */
export const mqttSourceKey = (tokens: readonly MqttSourceToken[]): string =>
  JSON.stringify(tokens.map((t) => (t.role === 'index' ? ['index', t.indices] : [t.role, t.name])))

/** Strict `lower..upper` parsing; anything else (including the open `*` bound) is rejected. */
export const parseMqttArrayDimension = (dimension: string): MqttArrayDimension | null => {
  const match = DIMENSION.exec(dimension)
  if (!match) return null
  const lower = Number(match[1])
  const upper = Number(match[2])
  if (lower < INT32_MIN || upper > INT32_MAX || lower > upper) return null
  return { lower, upper }
}

export const mqttArrayElementCount = (dimensions: readonly MqttArrayDimension[]): number =>
  dimensions.reduce((total, d) => total * (d.upper - d.lower + 1), 1)

/** Row-major indices of the element at `offset`, the order the compiler lays the array out in. */
export const mqttArrayIndicesAt = (dimensions: readonly MqttArrayDimension[], offset: number): number[] => {
  const indices = new Array<number>(dimensions.length)
  let rest = offset
  for (let i = dimensions.length - 1; i >= 0; i--) {
    const extent = dimensions[i].upper - dimensions[i].lower + 1
    indices[i] = dimensions[i].lower + (rest % extent)
    rest = Math.floor(rest / extent)
  }
  return indices
}

const memberClasses = (members: readonly MqttModelVariable[], allowed: ReadonlySet<string>): MqttModelVariable[] =>
  members.filter((m) => m.class === undefined || allowed.has(m.class))

const parseDimensions = (
  typeName: string,
  dimensions: ReadonlyArray<{ dimension: string }>,
  element: MqttModelTypeRef,
): ResolvedType => {
  if (dimensions.length === 0) return { kind: 'unsupported', typeName, reason: 'array_bounds_invalid' }
  if (dimensions.length > MQTT_LIMITS.maxIndicesPerToken) {
    return { kind: 'unsupported', typeName, reason: 'array_rank_too_high' }
  }
  const parsed: MqttArrayDimension[] = []
  for (const { dimension } of dimensions) {
    const bounds = parseMqttArrayDimension(dimension)
    if (bounds === null) return { kind: 'unsupported', typeName, reason: 'array_bounds_invalid' }
    parsed.push(bounds)
  }
  return { kind: 'array', typeName, dimensions: parsed, element }
}

const resolveType = (model: MqttSourceModel, ref: MqttModelTypeRef): ResolvedType => {
  if (ref.definition === 'array') {
    if (!ref.data) return { kind: 'unsupported', typeName: ref.value, reason: 'array_bounds_invalid' }
    return parseDimensions(ref.value, ref.data.dimensions, ref.data.baseType)
  }
  const upper = ref.value.trim().toUpperCase()
  const canonical = TYPE_ALIASES[upper] ?? upper
  if (isMqttIecType(canonical)) return { kind: 'leaf', iecType: canonical }
  if (ref.definition === 'base-type') return { kind: 'unsupported', typeName: ref.value, reason: 'type_unsupported' }

  const dataType = model.dataTypes.find((dt) => sameName(dt.name, ref.value))
  if (dataType?.derivation === 'structure') {
    return { kind: 'composite', typeName: dataType.name, members: dataType.variable }
  }
  if (dataType?.derivation === 'enumerated') {
    return { kind: 'unsupported', typeName: dataType.name, reason: 'type_enumeration' }
  }
  if (dataType?.derivation === 'array') {
    return parseDimensions(dataType.name, dataType.dimensions, dataType.baseType)
  }

  const userBlock = model.pous.find((p) => p.kind === 'function-block' && sameName(p.name, ref.value))
  if (userBlock) {
    return {
      kind: 'composite',
      typeName: userBlock.name,
      members: memberClasses(userBlock.variables, PERSISTENT_MEMBER_CLASSES),
    }
  }
  if (model.libraryFunctionBlocks === undefined) return { kind: 'opaque', typeName: ref.value }
  const libraryBlock = model.libraryFunctionBlocks.find((p) => sameName(p.name, ref.value))
  if (libraryBlock) {
    return {
      kind: 'composite',
      typeName: libraryBlock.name,
      members: memberClasses(libraryBlock.variables, LIBRARY_INTERFACE_CLASSES),
    }
  }
  return { kind: 'unsupported', typeName: ref.value, reason: 'type_unknown' }
}

const nodeLabel = (token: MqttSourceToken): string =>
  token.role === 'index' ? `[${token.indices.join(',')}]` : token.name

const buildNode = (
  model: MqttSourceModel,
  tokens: MqttSourceToken[],
  ref: MqttModelTypeRef,
  visiting: readonly string[],
): MqttTreeNode => {
  const base = { id: mqttSourceKey(tokens), label: nodeLabel(tokens[tokens.length - 1]), tokens }
  const resolved = resolveType(model, ref)
  switch (resolved.kind) {
    case 'leaf':
      return { ...base, kind: 'leaf', iecType: resolved.iecType, size: MQTT_DEBUG_SIZE[resolved.iecType] }
    case 'opaque':
      return { ...base, kind: 'opaque', typeName: resolved.typeName }
    case 'unsupported':
      return { ...base, kind: 'unsupported', typeName: resolved.typeName, reason: resolved.reason }
    case 'array':
      if (tokens.length >= MQTT_LIMITS.maxSourceTokens) {
        return { ...base, kind: 'unsupported', typeName: resolved.typeName, reason: 'path_too_deep' }
      }
      return {
        ...base,
        kind: 'array',
        typeName: resolved.typeName,
        dimensions: resolved.dimensions,
        elementCount: mqttArrayElementCount(resolved.dimensions),
        element: resolved.element,
      }
    case 'composite': {
      const key = resolved.typeName.toUpperCase()
      if (visiting.includes(key)) {
        return { ...base, kind: 'unsupported', typeName: resolved.typeName, reason: 'type_recursive' }
      }
      if (tokens.length >= MQTT_LIMITS.maxSourceTokens) {
        return { ...base, kind: 'unsupported', typeName: resolved.typeName, reason: 'path_too_deep' }
      }
      return {
        ...base,
        kind: 'composite',
        typeName: resolved.typeName,
        children: resolved.members.map((member) =>
          buildNode(model, [...tokens, { role: 'field', name: member.name }], member.type, [...visiting, key]),
        ),
      }
    }
  }
}

const programVariables = (model: MqttSourceModel, program: string): MqttModelVariable[] | null => {
  const pou = model.pous.find((p) => p.kind === 'program' && sameName(p.name, program))
  return pou ? memberClasses(pou.variables, PERSISTENT_MEMBER_CLASSES) : null
}

/** Arrays stay collapsed; {@link mqttArrayElements} materialises elements on demand. */
export const buildMqttSourceTree = (model: MqttSourceModel): MqttTreeNode[] => {
  const scopes: MqttTreeNode[] = model.instances.map((instance) => {
    const tokens: MqttSourceToken[] = [
      { role: 'instance', name: instance.name },
      { role: 'program', name: instance.program },
    ]
    const variables = programVariables(model, instance.program) ?? []
    return {
      id: mqttSourceKey(tokens),
      label: instance.name,
      tokens,
      kind: 'scope',
      scope: 'instance',
      program: instance.program,
      children: variables.map((v) => buildNode(model, [...tokens, { role: 'variable', name: v.name }], v.type, [])),
    }
  })
  if (model.globalVariables.length > 0) {
    const tokens: MqttSourceToken[] = [{ role: 'instance', name: MQTT_GLOBAL_SCOPE_NAME }]
    scopes.push({
      id: mqttSourceKey(tokens),
      label: MQTT_GLOBAL_SCOPE_NAME,
      tokens,
      kind: 'scope',
      scope: 'global',
      children: model.globalVariables.map((v) =>
        buildNode(model, [...tokens, { role: 'variable', name: v.name }], v.type, []),
      ),
    })
  }
  return scopes
}

type ArrayNode = Extract<MqttTreeNode, { kind: 'array' }>

/** Element node for explicit indices; null when the indices do not address an element. */
export const mqttArrayElement = (
  model: MqttSourceModel,
  node: ArrayNode,
  indices: readonly number[],
): MqttTreeNode | null => {
  if (indices.length !== node.dimensions.length) return null
  if (indices.some((index, i) => !Number.isInteger(index) || index < node.dimensions[i].lower)) return null
  if (indices.some((index, i) => index > node.dimensions[i].upper)) return null
  return buildNode(model, [...node.tokens, { role: 'index', indices: [...indices] }], node.element, [])
}

/** Up to `limit` element nodes starting at row-major `offset`. */
export const mqttArrayElements = (
  model: MqttSourceModel,
  node: ArrayNode,
  offset: number,
  limit: number,
): MqttTreeNode[] => {
  const end = Math.min(node.elementCount, offset + limit)
  const elements: MqttTreeNode[] = []
  for (let position = Math.max(0, offset); position < end; position++) {
    const element = mqttArrayElement(model, node, mqttArrayIndicesAt(node.dimensions, position))
    if (element) elements.push(element)
  }
  return elements
}

/** Number of selectable leaves under a node, arrays included, without materialising them. */
export const countMqttLeaves = (model: MqttSourceModel, node: MqttTreeNode): number => {
  switch (node.kind) {
    case 'leaf':
      return 1
    case 'scope':
    case 'composite':
      return node.children.reduce((total, child) => total + countMqttLeaves(model, child), 0)
    case 'array': {
      const first = mqttArrayElement(
        model,
        node,
        node.dimensions.map((d) => d.lower),
      )
      return first ? node.elementCount * countMqttLeaves(model, first) : 0
    }
    default:
      return 0
  }
}

/** Leaves under a node in tree order, stopping once more than `limit` are found. */
export const collectMqttLeaves = (
  model: MqttSourceModel,
  node: MqttTreeNode,
  limit: number,
): { leaves: Array<Extract<MqttTreeNode, { kind: 'leaf' }>>; truncated: boolean } => {
  const leaves: Array<Extract<MqttTreeNode, { kind: 'leaf' }>> = []
  const visit = (current: MqttTreeNode): boolean => {
    if (leaves.length > limit) return false
    switch (current.kind) {
      case 'leaf':
        leaves.push(current)
        return leaves.length <= limit
      case 'scope':
      case 'composite':
        return current.children.every(visit)
      case 'array':
        for (let position = 0; position < current.elementCount; position++) {
          const element = mqttArrayElement(model, current, mqttArrayIndicesAt(current.dimensions, position))
          if (element && !visit(element)) return false
        }
        return true
      default:
        return true
    }
  }
  const complete = visit(node)
  return complete ? { leaves, truncated: false } : { leaves: leaves.slice(0, limit), truncated: true }
}

const missing = (reason: MqttMissingReason): MqttSourceDescription => ({ status: 'missing', reason })

const scopeMembers = (
  model: MqttSourceModel,
  tokens: readonly MqttSourceToken[],
): { members: readonly MqttModelVariable[]; next: number } | MqttSourceDescription => {
  const [first, second] = tokens
  if (first.role !== 'instance' || second === undefined) return missing('token_shape')
  if (!isMqttIdentifier(first.name)) return missing('identifier_invalid')
  if (second.role === 'variable') {
    if (!sameName(first.name, MQTT_GLOBAL_SCOPE_NAME)) return missing('token_shape')
    return { members: model.globalVariables, next: 1 }
  }
  if (second.role !== 'program') return missing('token_shape')
  if (!isMqttIdentifier(second.name)) return missing('identifier_invalid')
  const instance = model.instances.find((i) => sameName(i.name, first.name))
  if (!instance) return missing('instance_missing')
  if (!sameName(instance.program, second.name)) return missing('program_mismatch')
  const variables = programVariables(model, instance.program)
  if (!variables) return missing('program_missing')
  return { members: variables, next: 2 }
}

/** Walks the declarations along a source path. The compiled debug map stays the authority for addresses. */
export const describeMqttSource = (
  model: MqttSourceModel,
  tokens: readonly MqttSourceToken[],
): MqttSourceDescription => {
  if (tokens.length < MQTT_LIMITS.minSourceTokens || tokens.length > MQTT_LIMITS.maxSourceTokens) {
    return missing('token_shape')
  }
  const scope = scopeMembers(model, tokens)
  if ('status' in scope) return scope
  if (tokens.length <= scope.next || tokens[scope.next].role !== 'variable') return missing('token_shape')

  let current: ResolvedType = { kind: 'composite', typeName: '', members: scope.members }
  for (let i = scope.next; i < tokens.length; i++) {
    const token = tokens[i]
    if (current.kind === 'opaque') return { status: 'opaque', typeName: current.typeName }
    if (current.kind === 'unsupported') {
      return { status: 'unsupported', reason: current.reason, typeName: current.typeName }
    }
    if (token.role === 'index') {
      if (current.kind !== 'array') return missing('not_an_array')
      const { dimensions } = current
      if (token.indices.length !== dimensions.length) return missing('index_rank_mismatch')
      const inRange = token.indices.every(
        (index, d) => Number.isInteger(index) && index >= dimensions[d].lower && index <= dimensions[d].upper,
      )
      if (!inRange) return missing('index_out_of_range')
      current = resolveType(model, current.element)
      continue
    }
    const expected = i === scope.next ? 'variable' : 'field'
    if (token.role !== expected) return missing('token_shape')
    if (!isMqttIdentifier(token.name)) return missing('identifier_invalid')
    if (current.kind !== 'composite') return missing('not_a_composite')
    const member = current.members.find((m) => sameName(m.name, token.name))
    if (!member) return missing('member_missing')
    current = resolveType(model, member.type)
  }
  switch (current.kind) {
    case 'leaf':
      return { status: 'leaf', iecType: current.iecType, size: MQTT_DEBUG_SIZE[current.iecType] }
    case 'opaque':
      return { status: 'opaque', typeName: current.typeName }
    case 'unsupported':
      return { status: 'unsupported', reason: current.reason, typeName: current.typeName }
    default:
      return { status: 'container' }
  }
}

const toModelVariable = (variable: { name: string; class?: string; type: MqttModelTypeRef }): MqttModelVariable => ({
  name: variable.name,
  ...(variable.class !== undefined ? { class: variable.class } : {}),
  type: variable.type,
})

const toModelDataType = (dataType: {
  name: string
  derivation: string
  variable?: ReadonlyArray<{ name: string; type: MqttModelTypeRef }>
  baseType?: { definition: string; value: string }
  dimensions?: ReadonlyArray<{ dimension: string }>
}): MqttModelDataType | null => {
  if (dataType.derivation === 'structure') {
    return { name: dataType.name, derivation: 'structure', variable: (dataType.variable ?? []).map(toModelVariable) }
  }
  if (dataType.derivation === 'enumerated') return { name: dataType.name, derivation: 'enumerated' }
  if (dataType.derivation === 'array' && dataType.baseType) {
    return {
      name: dataType.name,
      derivation: 'array',
      baseType: dataType.baseType,
      dimensions: dataType.dimensions ?? [],
    }
  }
  return null
}

interface GlobalListLike {
  name: string
  variables: ReadonlyArray<{ name: string; type: MqttModelTypeRef }>
}

/** A global variable list compiles to a struct type plus one global instance named after the list. */
const withGlobalLists = (
  dataTypes: MqttModelDataType[],
  globals: MqttModelVariable[],
  lists: readonly GlobalListLike[],
): { dataTypes: MqttModelDataType[]; globals: MqttModelVariable[] } => {
  const used = lists.filter((list) => list.variables.length > 0)
  return {
    dataTypes: [
      ...dataTypes,
      ...used.map(
        (list): MqttModelDataType => ({
          name: globalVariableListTypeName(list.name),
          derivation: 'structure',
          variable: list.variables.map(toModelVariable),
        }),
      ),
    ],
    globals: [
      ...globals,
      ...used.map((list) => ({
        name: list.name,
        type: { definition: 'user-data-type', value: globalVariableListTypeName(list.name) },
      })),
    ],
  }
}

/** Shape the compile pipeline receives (POUs as `{ type, data }`, singular `configuration`). */
export interface MqttCompileProjectLike {
  pous: ReadonlyArray<{
    type: string
    data: { name: string; variables: ReadonlyArray<{ name: string; class?: string; type: MqttModelTypeRef }> }
  }>
  dataTypes?: ReadonlyArray<Parameters<typeof toModelDataType>[0]>
  globalVariableLists?: readonly GlobalListLike[]
  configuration: {
    resource: {
      instances: ReadonlyArray<{ name: string; program: string }>
      globalVariables: ReadonlyArray<{ name: string; type: MqttModelTypeRef }>
    }
  }
}

export const mqttSourceModelFromCompileProject = (project: MqttCompileProjectLike): MqttSourceModel => {
  const merged = withGlobalLists(
    (project.dataTypes ?? []).map(toModelDataType).filter((dt): dt is MqttModelDataType => dt !== null),
    project.configuration.resource.globalVariables.map(toModelVariable),
    project.globalVariableLists ?? [],
  )
  return {
    instances: project.configuration.resource.instances.map((i) => ({ name: i.name, program: i.program })),
    pous: project.pous
      .filter((p) => p.type === 'program' || p.type === 'function-block')
      .map((p) => ({
        name: p.data.name,
        kind: p.type === 'program' ? 'program' : 'function-block',
        variables: p.data.variables.map(toModelVariable),
      })),
    dataTypes: merged.dataTypes,
    globalVariables: merged.globals,
  }
}

/** Store-shaped project plus the loaded libraries, for the selection UI. */
export interface MqttPortProjectLike {
  pous: readonly PLCPou[]
  dataTypes: readonly PLCDataType[]
  globalVariableLists?: readonly PLCGlobalVariableList[]
  configurations: {
    resource: {
      instances: ReadonlyArray<{ name: string; program: string }>
      globalVariables: readonly PLCVariable[]
    }
  }
}

export interface MqttLibraryLike {
  pous: ReadonlyArray<{
    name: string
    type: string
    variables: ReadonlyArray<{ name: string; class?: string; type: { definition: string; value: string } }>
  }>
}

export const mqttSourceModelFromPortProject = (
  project: MqttPortProjectLike,
  libraries?: readonly MqttLibraryLike[],
): MqttSourceModel => {
  const merged = withGlobalLists(
    project.dataTypes.map(toModelDataType).filter((dt): dt is MqttModelDataType => dt !== null),
    project.configurations.resource.globalVariables.map(toModelVariable),
    project.globalVariableLists ?? [],
  )
  return {
    instances: project.configurations.resource.instances.map((i) => ({ name: i.name, program: i.program })),
    pous: project.pous
      .filter((p) => p.pouType === 'program' || p.pouType === 'function-block')
      .map((p) => ({
        name: p.name,
        kind: p.pouType === 'program' ? 'program' : 'function-block',
        variables: (p.interface?.variables ?? []).map(toModelVariable),
      })),
    dataTypes: merged.dataTypes,
    globalVariables: merged.globals,
    ...(libraries !== undefined
      ? {
          libraryFunctionBlocks: libraries.flatMap((library) =>
            library.pous
              .filter((p) => p.type.toLowerCase().replace(/[-_]/g, '') === 'functionblock')
              .map((p): MqttModelPou => ({ name: p.name, kind: 'function-block', variables: p.variables })),
          ),
        }
      : {}),
  }
}
