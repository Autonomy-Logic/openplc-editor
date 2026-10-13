import type { MqttSourceToken } from '../contract/contract'
import { isMqttIdentifier, MQTT_GLOBAL_SCOPE_NAME } from '../project/source-model'

const MD5 = /^[0-9a-f]{32}$/

export interface MqttProgramLeaf {
  arr: number
  elem: number
  /** Exact path string the compiler wrote; the runtime compares it verbatim. */
  path: string
  type: string
  size: number
}

/** One compiled program's debug map, indexed for source resolution. */
export interface MqttProgramMap {
  md5: string
  leaves: ReadonlyMap<string, MqttProgramLeaf>
  /** Uppercase paths that only exist as parents of leaves (structs, FB instances, arrays). */
  containers: ReadonlySet<string>
}

export type MqttUnresolvedReason =
  | 'token_shape'
  | 'identifier_invalid'
  | 'instance_missing'
  | 'program_mismatch'
  | 'leaf_missing'
  | 'not_a_leaf'

export type MqttProgramResolution =
  | { ok: true; leaf: MqttProgramLeaf }
  | { ok: false; reason: MqttUnresolvedReason; debugPath: string | null }

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const addContainers = (path: string, containers: Set<string>): void => {
  for (let i = 1; i < path.length; i++) {
    if (path[i] === '.' || path[i] === '[') containers.add(path.slice(0, i))
  }
}

/** Strict `debug-map.json` (format v2) reader; null when the map cannot be trusted. */
export const parseMqttProgramMap = (content: string): MqttProgramMap | null => {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.version !== 2 || typeof raw.md5 !== 'string' || !MD5.test(raw.md5)) return null
  if (!Array.isArray(raw.leaves)) return null
  const leaves = new Map<string, MqttProgramLeaf>()
  const addresses = new Set<number>()
  const containers = new Set<string>()
  for (const entry of raw.leaves) {
    if (!isRecord(entry)) return null
    const { arrayIdx, elemIdx, path, type, size } = entry
    if (!isIntegerIn(arrayIdx, 0, 255) || !isIntegerIn(elemIdx, 0, 65535) || !isIntegerIn(size, 1, 65535)) {
      return null
    }
    if (typeof path !== 'string' || path === '' || typeof type !== 'string') return null
    const key = path.toUpperCase()
    const address = arrayIdx * 65536 + elemIdx
    if (leaves.has(key) || addresses.has(address)) return null
    leaves.set(key, { arr: arrayIdx, elem: elemIdx, path, type, size })
    addresses.add(address)
    addContainers(key, containers)
  }
  for (const key of leaves.keys()) containers.delete(key)
  return { md5: raw.md5, leaves, containers }
}

const sameName = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

/** Each step is an identifier, so no token can smuggle a path. */
export const mqttDebugPath = (
  tokens: readonly MqttSourceToken[],
  instances: ReadonlyArray<{ name: string; program: string }>,
): { path: string } | { reason: MqttUnresolvedReason } => {
  const [first, second] = tokens
  if (tokens.length < 2 || first.role !== 'instance') return { reason: 'token_shape' }
  if (!isMqttIdentifier(first.name)) return { reason: 'identifier_invalid' }
  let path: string
  let next: number
  if (second.role === 'variable') {
    if (!sameName(first.name, MQTT_GLOBAL_SCOPE_NAME)) return { reason: 'token_shape' }
    path = ''
    next = 1
  } else if (second.role === 'program') {
    if (!isMqttIdentifier(second.name)) return { reason: 'identifier_invalid' }
    const instance = instances.find((i) => sameName(i.name, first.name))
    if (!instance) return { reason: 'instance_missing' }
    if (!sameName(instance.program, second.name)) return { reason: 'program_mismatch' }
    path = first.name.toUpperCase()
    next = 2
  } else {
    return { reason: 'token_shape' }
  }
  if (tokens.length <= next || tokens[next].role !== 'variable') return { reason: 'token_shape' }
  for (let i = next; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.role === 'index') {
      if (i === next || token.indices.length === 0 || !token.indices.every(Number.isSafeInteger)) {
        return { reason: 'token_shape' }
      }
      path += token.indices.map((index) => `[${index}]`).join('')
      continue
    }
    if (token.role !== (i === next ? 'variable' : 'field')) return { reason: 'token_shape' }
    if (!isMqttIdentifier(token.name)) return { reason: 'identifier_invalid' }
    path += `${path === '' ? '' : '.'}${token.name.toUpperCase()}`
  }
  return { path }
}

/** Resolves source tokens to the compiled leaf. Never falls back to another scope. */
export const resolveMqttSource = (
  tokens: readonly MqttSourceToken[],
  instances: ReadonlyArray<{ name: string; program: string }>,
  program: MqttProgramMap,
): MqttProgramResolution => {
  const computed = mqttDebugPath(tokens, instances)
  if ('reason' in computed) return { ok: false, reason: computed.reason, debugPath: null }
  const leaf = program.leaves.get(computed.path)
  if (leaf) return { ok: true, leaf }
  return {
    ok: false,
    reason: program.containers.has(computed.path) ? 'not_a_leaf' : 'leaf_missing',
    debugPath: computed.path,
  }
}
