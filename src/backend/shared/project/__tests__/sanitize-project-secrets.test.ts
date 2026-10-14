import { createDefaultMqttIntegration } from '../../../../frontend/utils/mqtt/project/model'
import { sanitizeProjectFileContent, sanitizeProjectFiles } from '../sanitize-project-secrets'

const PASSWORD = 'MARKER-PW-e5-sanitize-41aa'
const KEY = 'MARKER-KEY-e5-sanitize-9b0e'

const integration = { ...createDefaultMqttIntegration('plc-1'), authMethod: 'username_password' as const }
const cleanServer = { name: 'broker', protocol: 'mqtt', mqttConfig: integration }
const cleanText = JSON.stringify(cleanServer, null, 2)

const withSecrets = {
  name: 'broker',
  protocol: 'mqtt',
  password: PASSWORD,
  mqttConfig: { ...integration, password: PASSWORD, privateKeyPem: KEY, credential_ref: { id: 'x' } },
}

const hasMarker = (text: string): boolean => text.includes(PASSWORD) || text.includes(KEY)

describe('sanitizeProjectFileContent', () => {
  it('keeps a clean MQTT server file byte for byte', () => {
    expect(sanitizeProjectFileContent(cleanText)).toEqual({ kind: 'unchanged' })
    const compact = JSON.stringify(cleanServer)
    expect(sanitizeProjectFileContent(compact)).toEqual({ kind: 'unchanged' })
  })

  it('reduces an MQTT server file with secret members to the project model', () => {
    const outcome = sanitizeProjectFileContent(JSON.stringify(withSecrets))
    expect(outcome.kind).toBe('sanitized')
    if (outcome.kind !== 'sanitized') return
    expect(hasMarker(outcome.content)).toBe(false)
    expect(JSON.parse(outcome.content)).toEqual(cleanServer)
  })

  it('recognises a server by content, whatever the file is called or whether protocol was edited', () => {
    const disguised = { ...withSecrets, protocol: 'modbus-tcp' }
    const outcome = sanitizeProjectFileContent(JSON.stringify(disguised))
    expect(outcome.kind).toBe('sanitized')
    if (outcome.kind === 'sanitized') expect(hasMarker(outcome.content)).toBe(false)
  })

  it('leaves out MQTT content that does not fit the model instead of passing it through', () => {
    const future = { name: 'broker', protocol: 'mqtt', mqttConfig: { formatVersion: 2, password: PASSWORD } }
    expect(sanitizeProjectFileContent(JSON.stringify(future))).toEqual({ kind: 'excluded' })
  })

  it('cleans legacy servers inside project.json and drops unreadable MQTT entries', () => {
    const modbus = { name: 'slave', protocol: 'modbus-tcp' }
    const project = {
      meta: { name: 'p', type: 'plc-project' },
      data: { pous: [], servers: [modbus, withSecrets, { protocol: 'mqtt', password: PASSWORD }] },
    }
    const outcome = sanitizeProjectFileContent(JSON.stringify(project))
    expect(outcome.kind).toBe('sanitized')
    if (outcome.kind !== 'sanitized') return
    expect(hasMarker(outcome.content)).toBe(false)
    const parsed = JSON.parse(outcome.content) as { meta: unknown; data: { servers: unknown[]; pous: unknown[] } }
    expect(parsed.meta).toEqual(project.meta)
    expect(parsed.data.servers).toEqual([modbus, cleanServer])
  })

  it('does not touch other documents or non-JSON text', () => {
    const plain = `PROGRAM main\n  (* password: ${PASSWORD} *)\nEND_PROGRAM`
    expect(sanitizeProjectFileContent(plain)).toEqual({ kind: 'unchanged' })
    expect(sanitizeProjectFileContent('{not json')).toEqual({ kind: 'unchanged' })
    expect(sanitizeProjectFileContent(JSON.stringify({ name: 'slave', protocol: 'modbus-tcp' }))).toEqual({
      kind: 'unchanged',
    })
    expect(sanitizeProjectFileContent(JSON.stringify({ data: { servers: [{ protocol: 's7comm' }] } }))).toEqual({
      kind: 'unchanged',
    })
  })
})

describe('sanitizeProjectFiles', () => {
  it('returns the materialised file map and names what changed or was left out', () => {
    const files = new Map([
      ['project.json', JSON.stringify({ meta: { name: 'p' }, data: { pous: [] } })],
      ['devices/servers/broker.json', cleanText],
      ['devices/servers/broker.json.bak', JSON.stringify(withSecrets)],
      ['devices/servers/future.json', JSON.stringify({ protocol: 'mqtt', mqttConfig: { password: KEY } })],
      ['pous/programs/main.st', 'PROGRAM main END_PROGRAM'],
    ])
    const result = sanitizeProjectFiles(files)
    expect(result.sanitized).toEqual(['devices/servers/broker.json.bak'])
    expect(result.excluded).toEqual(['devices/servers/future.json'])
    expect([...result.files.keys()]).toEqual([
      'project.json',
      'devices/servers/broker.json',
      'devices/servers/broker.json.bak',
      'pous/programs/main.st',
    ])
    expect(result.files.get('devices/servers/broker.json')).toBe(cleanText)
    for (const content of result.files.values()) expect(hasMarker(content)).toBe(false)
  })
})
