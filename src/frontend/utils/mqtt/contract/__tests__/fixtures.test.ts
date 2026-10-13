import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import capabilities from '../fixtures/api/capabilities.json'
import errorCodes from '../fixtures/errors/error-codes.json'
import cases from '../fixtures/runtime-config/cases.json'
import values from '../fixtures/values/value-vectors.json'
import {
  isMqttIecType,
  MQTT_CONFIG_ERROR_CODES,
  MQTT_CREDENTIAL_STAGING,
  MQTT_DEBUG_SIZE,
  MQTT_IEC_TYPES,
  MQTT_LIMITS,
  MQTT_RUNTIME_CONFIG_CONTRACT,
  MQTT_RUNTIME_CONFIG_FORMAT_VERSION,
} from '../contract'
import { findDestinationConflicts, validateMetricName, validateNodeId, validateTopic } from '../names'

const FIXTURES = join(__dirname, '..', 'fixtures')
const CONFIG_DIR = join(FIXTURES, 'runtime-config')

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })

const relPosix = (from: string, file: string): string => relative(from, file).split(sep).join('/')

type JsonObject = { [key: string]: unknown }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJson = (file: string): JsonObject => {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
  if (!isObject(parsed)) throw new Error(`${file} is not a JSON object`)
  return parsed
}

const nameErrors = (doc: JsonObject): Array<[string, string]> => {
  const leaves = doc.leaves
  if (!Array.isArray(leaves)) throw new Error('leaves missing')
  const destinations = leaves.map((leaf: unknown) => (isObject(leaf) ? String(leaf.destination) : ''))
  const generic = doc.mode === 'generic'
  const out: Array<[string, string]> = []
  destinations.forEach((destination, i) => {
    const error = generic ? validateTopic(destination) : validateMetricName(destination)
    if (error) out.push([`/leaves/${i}/destination`, error])
  })
  for (const c of findDestinationConflicts(generic ? 'generic' : 'sparkplug_b', destinations)) {
    out.push([`/leaves/${c.second}/destination`, c.code])
  }
  const section = doc.sparkplug
  if (isObject(section)) {
    for (const key of ['group_id', 'edge_node_id']) {
      const error = validateNodeId(String(section[key]))
      if (error) out.push([`/sparkplug/${key}`, error])
    }
  }
  return out
}

describe('MQTT shared fixtures', () => {
  it('match the manifest byte for byte', () => {
    const manifest = new Map(
      readFileSync(join(FIXTURES, 'MANIFEST.sha256'), 'utf-8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line): [string, string] => {
          const [digest, rel] = line.split('  ')
          return [rel, digest]
        }),
    )
    const onDisk = listFiles(FIXTURES)
      .map((f) => relPosix(FIXTURES, f))
      .filter((rel) => rel !== 'MANIFEST.sha256')
      .sort()
    expect([...manifest.keys()].sort()).toEqual(onDisk)
    for (const rel of onDisk) {
      const digest = createHash('sha256')
        .update(readFileSync(join(FIXTURES, rel), 'utf-8'), 'utf8')
        .digest('hex')
      expect([rel, digest]).toEqual([rel, manifest.get(rel)])
    }
  })

  it('list every runtime config fixture in cases.json', () => {
    const listed = new Set([...cases.valid, ...cases.invalid.map((c) => c.file)])
    const onDisk = listFiles(CONFIG_DIR)
      .map((f) => relPosix(CONFIG_DIR, f))
      .filter((rel) => rel.startsWith('valid/') || rel.startsWith('invalid/'))
    expect([...listed].sort()).toEqual(onDisk.sort())
  })

  it.each(cases.valid)('valid config %s has no name errors', (rel) => {
    expect(nameErrors(readJson(join(CONFIG_DIR, rel)))).toEqual([])
  })

  it.each(cases.invalid.filter((c) => c.layer === 'names' || c.layer === 'semantic'))(
    'name layer of $file',
    ({ file, layer, pointer, detail }) => {
      const found = nameErrors(readJson(join(CONFIG_DIR, file)))
      if (layer === 'names') expect(found).toContainEqual([pointer, detail])
      else expect(found).toEqual([])
    },
  )

  it('keep 64-bit generic values as strings so JSON numbers never lose precision', () => {
    for (const v of values.vectors) {
      const parsed: unknown = JSON.parse(v.generic)
      if (!isObject(parsed)) throw new Error(v.id)
      const wide = ['LINT', 'ULINT', 'LWORD', 'TIME'].includes(v.iecType)
      if (wide && parsed.value !== null) expect([v.id, typeof parsed.value]).toEqual([v.id, 'string'])
      expect(parsed.value === null).toBe(v.sparkplug.isNull)
    }
  })

  it('agree with the TypeScript contract constants', () => {
    expect(capabilities.limits).toEqual({
      maxLeaves: MQTT_LIMITS.maxLeaves,
      maxNameBytes: MQTT_LIMITS.maxNameBytes,
      maxPayloadBytes: MQTT_LIMITS.maxPayloadBytes,
      maxConfigBytes: MQTT_LIMITS.maxConfigBytes,
    })
    expect(capabilities.credentials.stagingTtlSeconds).toBe(MQTT_CREDENTIAL_STAGING.ttlSeconds)
    expect(capabilities.credentials.maxStaged).toBe(MQTT_CREDENTIAL_STAGING.maxStaged)
    expect(capabilities.runtimeConfig).toEqual({
      contract: MQTT_RUNTIME_CONFIG_CONTRACT,
      formatVersions: [MQTT_RUNTIME_CONFIG_FORMAT_VERSION],
    })
    const configCodes = Object.entries(errorCodes.codes)
      .filter(([, category]) => category === 'configuration')
      .map(([code]) => code)
      .sort()
    expect([...MQTT_CONFIG_ERROR_CODES].sort()).toEqual(configCodes)
  })

  it('size every leaf type exactly as the debug map does', () => {
    const debugMap = readJson(join(CONFIG_DIR, 'debug-map.json'))
    const leaves = debugMap.leaves
    if (!Array.isArray(leaves)) throw new Error('leaves missing')
    for (const leaf of leaves) {
      if (!isObject(leaf)) throw new Error('leaf')
      const type = String(leaf.type)
      expect(isMqttIecType(type)).toBe(true)
      if (isMqttIecType(type)) expect(leaf.size).toBe(MQTT_DEBUG_SIZE[type])
    }
    expect(isMqttIecType('MOTOR_T')).toBe(false)
    expect(MQTT_IEC_TYPES).toHaveLength(21)
  })
})
