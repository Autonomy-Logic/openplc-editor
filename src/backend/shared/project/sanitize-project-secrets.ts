// Content-based, not name-based: renamed copies and legacy project.json servers are reduced too.

import { toPersistedServer } from '../../../frontend/utils/mqtt/project/model'
import { PLCServerSchema } from '../types/PLC/open-plc'

export type SanitizedProjectFile = { kind: 'unchanged' } | { kind: 'sanitized'; content: string } | { kind: 'excluded' }

export interface SanitizedProjectFiles {
  files: Map<string, string>
  /** Paths whose content was reduced to the project model. */
  sanitized: string[]
  /** Paths left out because their MQTT content could not be read. */
  excluded: string[]
}

type JsonRecord = { [key: string]: unknown }

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const describesMqttServer = (value: JsonRecord): boolean => value.protocol === 'mqtt' || 'mqttConfig' in value

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  }
  if (!isRecord(a) || !isRecord(b)) return false
  const definedKeys = (value: JsonRecord) => Object.keys(value).filter((key) => value[key] !== undefined)
  const keys = definedKeys(a)
  return keys.length === definedKeys(b).length && keys.every((key) => deepEqual(a[key], b[key]))
}

/** The server reduced to the project model, or null when it does not fit the model. */
const persistedServer = (value: JsonRecord): unknown => {
  const parsed = PLCServerSchema.safeParse(value)
  return parsed.success ? toPersistedServer(parsed.data) : null
}

const parseJsonObject = (content: string): unknown => {
  if (!content.trimStart().startsWith('{')) return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

export function sanitizeProjectFileContent(content: string): SanitizedProjectFile {
  const document = parseJsonObject(content)
  if (!isRecord(document)) return { kind: 'unchanged' }

  if (describesMqttServer(document)) {
    const persisted = persistedServer(document)
    if (persisted === null) return { kind: 'excluded' }
    return deepEqual(persisted, document)
      ? { kind: 'unchanged' }
      : { kind: 'sanitized', content: JSON.stringify(persisted, null, 2) }
  }

  const data = document.data
  const isMqttEntry = (server: unknown): server is JsonRecord => isRecord(server) && describesMqttServer(server)
  if (!isRecord(data) || !Array.isArray(data.servers) || !data.servers.some(isMqttEntry)) {
    return { kind: 'unchanged' }
  }
  const servers: unknown[] = []
  for (const server of data.servers) {
    if (!isMqttEntry(server)) {
      servers.push(server)
      continue
    }
    const persisted = persistedServer(server)
    if (persisted !== null) servers.push(persisted)
  }
  if (deepEqual(servers, data.servers)) return { kind: 'unchanged' }
  return { kind: 'sanitized', content: JSON.stringify({ ...document, data: { ...data, servers } }, null, 2) }
}

export function sanitizeProjectFiles(files: ReadonlyMap<string, string>): SanitizedProjectFiles {
  const result: SanitizedProjectFiles = { files: new Map(), sanitized: [], excluded: [] }
  for (const [path, content] of files) {
    const outcome = sanitizeProjectFileContent(content)
    if (outcome.kind === 'excluded') {
      result.excluded.push(path)
      continue
    }
    if (outcome.kind === 'sanitized') result.sanitized.push(path)
    result.files.set(path, outcome.kind === 'sanitized' ? outcome.content : content)
  }
  return result
}
