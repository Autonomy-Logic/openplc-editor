import { parseProjectFiles } from '../../../backend/shared/utils/parse-project-files'
import type { PlatformCapabilities } from '../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort, RawProjectFile } from '../../../middleware/shared/ports/project-port'
import type { PLCServer } from '../../../middleware/shared/ports/types'
import { buildAllProjectFileContentsPure, executeSaveFile } from '../../services/save-actions'
import type { MqttProjectIntegrationV1 } from '../../utils/mqtt/contract/contract'
import { createDefaultMqttIntegration, mqttCredentialRequirement } from '../../utils/mqtt/project/model'
import { validateMqttCredentialPresence, validateMqttIntegration } from '../../utils/mqtt/project/validate'
import type { OpenPLCStore } from '../index'
import { createTestStore } from '../testing'

const SECRET_MARKER = 'MARKER-SECRET-e1-4b8d'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const serverNamed = (target: OpenPLCStore, name: string): PLCServer | undefined =>
  (target.getState().project.data.servers ?? []).find((s) => s.name === name)

const mqttOf = (target: OpenPLCStore, name: string): MqttProjectIntegrationV1 => {
  const config = serverNamed(target, name)?.mqttConfig
  if (!config) throw new Error(`${name} has no MQTT configuration`)
  return config
}

const createMqttServer = (name: string) => {
  const result = store.getState().projectActions.createServer({ data: { name, protocol: 'mqtt' } })
  expect(result.ok).toBe(true)
}

/** Saves the store and opens the written files in a fresh store, as a reopen does. */
const saveAndReopen = (extraServerFiles: RawProjectFile[] = []) => {
  const files = buildAllProjectFileContentsPure(store)
  const serverFiles: RawProjectFile[] = Object.entries(files)
    .filter(([path]) => path.startsWith('devices/servers/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  const parsed = parseProjectFiles(
    '/projects/p',
    files['project.json'],
    files['devices/configuration.json'],
    files['devices/pin-mapping.json'],
    [],
    [...serverFiles, ...extraServerFiles],
    [],
  )
  const reopened = createTestStore()
  reopened.getState().sharedWorkspaceActions.handleOpenProjectResponse(parsed)
  return { files, parsed, reopened }
}

const editedIntegration = (base: MqttProjectIntegrationV1): MqttProjectIntegrationV1 => ({
  ...base,
  enabled: true,
  mode: 'sparkplug_b',
  authMethod: 'username_password',
  connection: {
    host: 'broker.plant.local',
    port: 8884,
    clientId: 'plc-linha1',
    tls: {
      enabled: true,
      trust: { source: 'pem', caPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n' },
    },
  },
  generic: { ...base.generic, publishMode: 'periodic', qos: 1, retain: true, topicPrefix: 'plant/line1' },
  sparkplug: { groupId: 'Plant', edgeNodeId: 'Line1', sampleIntervalMs: 250 },
  selections: [
    {
      source: {
        tokens: [
          { role: 'instance', name: 'Instancia' },
          { role: 'program', name: 'MAIN' },
          { role: 'variable', name: 'Sensores' },
          { role: 'index', indices: [-3] },
          { role: 'field', name: 'Valor' },
        ],
      },
      metricName: 'Sensores.Minus3',
    },
    // A reference to a variable that no longer exists must survive as written.
    {
      source: {
        tokens: [
          { role: 'program', name: 'MAIN' },
          { role: 'variable', name: 'RenamedAway' },
        ],
      },
    },
    { source: { tokens: [{ role: 'variable', name: 'Broken' }] }, topic: '$bad/#' },
  ],
})

describe('MQTT server persistence', () => {
  it('creates a new MQTT server with the documented defaults, disabled', () => {
    createMqttServer('plc-linha1')
    expect(mqttOf(store, 'plc-linha1')).toEqual(createDefaultMqttIntegration('plc-linha1'))
  })

  it('saves and reopens every field, including selections that are no longer valid', () => {
    createMqttServer('Broker')
    const edited = editedIntegration(mqttOf(store, 'Broker'))
    expect(store.getState().projectActions.updateMqttServerConfig('Broker', edited).ok).toBe(true)

    const { files, parsed, reopened } = saveAndReopen()

    const written: unknown = JSON.parse(files['devices/servers/Broker.json'])
    expect(written).toEqual({ name: 'Broker', protocol: 'mqtt', mqttConfig: edited })
    expect((parsed.warnings ?? []).filter((w) => w.includes('Server'))).toEqual([])
    expect(mqttOf(reopened, 'Broker')).toEqual(edited)
    expect(reopened.getState().files['Broker']).toEqual({ type: 'server', filePath: 'Broker', saved: true })

    const issues = validateMqttIntegration(mqttOf(reopened, 'Broker')).map((i) => [i.code, i.pointer])
    expect(issues).toEqual([['project_selection_invalid', '/selections/2/source/tokens']])
  })

  it('never writes a secret that reached the in-memory model, and reopens without it', () => {
    createMqttServer('Broker')
    const edited = editedIntegration(mqttOf(store, 'Broker'))
    const polluted: MqttProjectIntegrationV1 = Object.assign(edited, {
      password: SECRET_MARKER,
      connection: Object.assign({ ...edited.connection }, { username: SECRET_MARKER }),
    })
    const server = serverNamed(store, 'Broker')
    if (!server) throw new Error('server missing')
    store.getState().projectActions.setProject({
      ...store.getState().project,
      data: {
        ...store.getState().project.data,
        servers: [{ ...server, mqttConfig: polluted }],
      },
    })

    const { files, reopened } = saveAndReopen()
    for (const content of Object.values(files)) expect(content).not.toContain(SECRET_MARKER)
    expect(JSON.stringify(reopened.getState().project)).not.toContain(SECRET_MARKER)
  })

  it('reopens a secret-based integration as needing a credential, without any secret on disk', () => {
    createMqttServer('Broker')
    store.getState().projectActions.updateMqttServerConfig('Broker', editedIntegration(mqttOf(store, 'Broker')))
    const { files, reopened } = saveAndReopen()

    const config = mqttOf(reopened, 'Broker')
    expect(mqttCredentialRequirement(config)).toEqual({ required: true, method: 'username_password' })
    expect(validateMqttCredentialPresence(config, { present: false }).map((i) => i.code)).toEqual([
      'config_credential_missing',
    ])
    expect(files['devices/servers/Broker.json']).not.toMatch(
      /"(password|username|credential_?ref|staging_?id|privateKey|clientKey)"\s*:/i,
    )
  })

  it('drops an unreadable server file from the model with a warning, never silently', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { parsed } = saveAndReopen([
      {
        relativePath: 'devices/servers/Future.json',
        content: JSON.stringify({ name: 'Future', protocol: 'mqtt', mqttConfig: { formatVersion: 2 } }),
      },
    ])
    expect(parsed.projectData.servers ?? []).toEqual([])
    expect(parsed.warnings ?? []).toContain(
      'Server file "devices/servers/Future.json" has invalid configuration and was skipped.',
    )
    error.mockRestore()
  })
})

describe('saving one MQTT server file', () => {
  it('writes the persisted form through the single-file save as well', async () => {
    const created = store.getState().serverActions.create({ name: 'Broker', protocol: 'mqtt' })
    expect(created.ok).toBe(true)
    const edited = editedIntegration(mqttOf(store, 'Broker'))
    const server = serverNamed(store, 'Broker')
    if (!server) throw new Error('server missing')
    store.getState().projectActions.setProject({
      ...store.getState().project,
      data: {
        ...store.getState().project.data,
        servers: [{ ...server, mqttConfig: Object.assign({ ...edited }, { password: SECRET_MARKER }) }],
      },
    })
    const saveFile = vi.fn().mockResolvedValue({ success: true })
    const projectPort = { saveFile, saveProject: vi.fn(), trackRecentProject: vi.fn() } as unknown as ProjectPort
    const capabilities = { isNativeApplication: true, hasEdgeAccount: true } as PlatformCapabilities

    const result = await executeSaveFile(store, 'Broker', projectPort, capabilities)

    expect(result.success).toBe(true)
    const call = saveFile.mock.calls.find((c: unknown[]) => String(c[0]).endsWith('Broker.json'))
    const content = typeof call?.[1] === 'string' ? call[1] : ''
    expect(content).not.toContain(SECRET_MARKER)
    expect(JSON.parse(content)).toEqual({ name: 'Broker', protocol: 'mqtt', mqttConfig: edited })
  })
})

describe('one enabled MQTT integration per runtime', () => {
  beforeEach(() => {
    createMqttServer('A')
    createMqttServer('B')
  })

  it('accepts enabling one and refuses enabling a second', () => {
    const actions = store.getState().projectActions
    expect(actions.updateMqttServerConfig('A', { ...mqttOf(store, 'A'), enabled: true }).ok).toBe(true)
    const refused = actions.updateMqttServerConfig('B', { ...mqttOf(store, 'B'), enabled: true })
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('"A" is already enabled')
    expect(mqttOf(store, 'B').enabled).toBe(false)
  })

  it('still saves edits to a disabled integration while another is enabled', () => {
    const actions = store.getState().projectActions
    actions.updateMqttServerConfig('A', { ...mqttOf(store, 'A'), enabled: true })
    const b = mqttOf(store, 'B')
    expect(actions.updateMqttServerConfig('B', { ...b, connection: { ...b.connection, host: 'other' } }).ok).toBe(true)
    expect(mqttOf(store, 'B').connection.host).toBe('other')
  })

  it('creates a duplicate of the enabled integration disabled', () => {
    store.getState().projectActions.updateMqttServerConfig('A', { ...mqttOf(store, 'A'), enabled: true })
    expect(store.getState().serverActions.duplicate('A', 'A_copy').ok).toBe(true)
    expect(mqttOf(store, 'A_copy').enabled).toBe(false)
    expect(mqttOf(store, 'A').enabled).toBe(true)
  })

  it('refuses MQTT configuration on a server of another protocol', () => {
    store.getState().projectActions.createServer({ data: { name: 'M', protocol: 'modbus-tcp' } })
    expect(store.getState().projectActions.updateMqttServerConfig('M', mqttOf(store, 'A')).ok).toBe(false)
    expect(serverNamed(store, 'M')?.mqttConfig).toBeUndefined()
  })
})

describe('projects saved before MQTT', () => {
  it('open and save their servers unchanged', () => {
    const modbus = {
      name: 'Slave',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: { enabled: true, transports: ['tcp'], networkInterface: '0.0.0.0', port: 502 },
    }
    const legacyFile = { relativePath: 'devices/servers/Slave.json', content: JSON.stringify(modbus, null, 2) }
    const parsed = parseProjectFiles(
      '/projects/old',
      JSON.stringify({
        meta: { name: 'Old', type: 'plc-project' },
        data: {
          dataTypes: [],
          pous: [],
          configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
        },
      }),
      JSON.stringify({ deviceBoard: 'OpenPLC Runtime v4', communicationPort: '', compileOnly: false }),
      JSON.stringify([]),
      [],
      [legacyFile],
      [],
    )
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(parsed)
    expect(store.getState().project.data.servers).toEqual([modbus])
    expect(buildAllProjectFileContentsPure(store)['devices/servers/Slave.json']).toBe(legacyFile.content)
  })
})
