import capabilities from '../../contract/fixtures/api/capabilities.json'
import { MQTT_DEFAULTS, MQTT_LIMITS, type MqttProjectIntegrationV1 } from '../../contract/contract'
import { validateClientId } from '../../contract/names'
import {
  createDefaultMqttIntegration,
  MQTT_DEFAULT_CLIENT_ID,
  mqttCredentialRequirement,
  suggestMqttClientId,
  toPersistedMqttIntegration,
  toPersistedServer,
  withMqttTlsEnabled,
} from '../model'

const SECRET_MARKER = 'MARKER-SECRET-7f3a9c'

describe('default MQTT integration', () => {
  const integration = createDefaultMqttIntegration('plc-linha1')

  it('starts disabled, in generic mode, anonymous, with TLS on the TLS port and system trust', () => {
    expect(integration.formatVersion).toBe(1)
    expect(integration.enabled).toBe(false)
    expect(integration.mode).toBe('generic')
    expect(integration.authMethod).toBe('anonymous')
    expect(integration.connection).toEqual({
      host: '',
      port: 8883,
      clientId: 'plc-linha1',
      tls: { enabled: true, trust: { source: 'system' } },
    })
  })

  it('publishes on change, sampling every 100 ms, periodic interval 1000 ms, QoS 0 and no retain', () => {
    expect(integration.generic).toEqual({
      publishMode: 'on_change',
      sampleIntervalMs: 100,
      publishIntervalMs: 1000,
      qos: 0,
      retain: false,
    })
    expect(integration.generic.topicPrefix).toBeUndefined()
  })

  it('samples Sparkplug every 100 ms and keeps the Edge Node ID equal to the client ID', () => {
    expect(integration.sparkplug).toEqual({ groupId: 'openplc', edgeNodeId: 'plc-linha1', sampleIntervalMs: 100 })
  })

  it('agrees with the shared constants and the runtime capabilities fixture', () => {
    expect(MQTT_DEFAULTS.enabled).toBe(integration.enabled)
    expect(MQTT_DEFAULTS.tlsPort).toBe(integration.connection.port)
    expect(capabilities.limits.maxLeaves).toBe(MQTT_LIMITS.maxLeaves)
    expect(capabilities.modes).toContain(integration.mode)
  })

  it('holds no secret, username or runtime credential reference', () => {
    const text = JSON.stringify(integration)
    for (const key of ['password', 'username', 'credential_ref', 'credentialRef', 'privateKey', 'client_key']) {
      expect(text).not.toContain(key)
    }
    expect(integration.selections).toEqual([])
  })

  it('falls back to a valid client ID when none is given', () => {
    expect(createDefaultMqttIntegration().connection.clientId).toBe(MQTT_DEFAULT_CLIENT_ID)
  })
})

describe('suggestMqttClientId', () => {
  it.each([
    ['plc-linha1', 'plc-linha1'],
    ['MQTT Server 1', 'MQTT-Server-1'],
    ['__x', 'x'],
    ['Válvula/Ç', 'V-lvula-'],
    ['***', MQTT_DEFAULT_CLIENT_ID],
    ['', MQTT_DEFAULT_CLIENT_ID],
  ])('turns %p into %p', (name, expected) => {
    expect(suggestMqttClientId(name)).toBe(expected)
  })

  it('always satisfies the runtime client ID rule, including long names', () => {
    for (const name of ['a'.repeat(200), '9lives', '-.-', 'x'.repeat(64)]) {
      expect(validateClientId(suggestMqttClientId(name))).toBeNull()
    }
  })
})

describe('withMqttTlsEnabled', () => {
  const base = createDefaultMqttIntegration('c1')

  it('moves the default TLS port to the plaintext default and back', () => {
    const plain = withMqttTlsEnabled(base, false)
    expect(plain.connection.tls).toEqual({ enabled: false })
    expect(plain.connection.port).toBe(1883)
    const tls = withMqttTlsEnabled(plain, true)
    expect(tls.connection.tls).toEqual({ enabled: true, trust: { source: 'system' } })
    expect(tls.connection.port).toBe(8883)
  })

  it('keeps a port the user chose', () => {
    const custom: MqttProjectIntegrationV1 = { ...base, connection: { ...base.connection, port: 9001 } }
    expect(withMqttTlsEnabled(custom, false).connection.port).toBe(9001)
  })

  it('keeps the trusted CA when TLS stays enabled', () => {
    const pem: MqttProjectIntegrationV1 = {
      ...base,
      connection: { ...base.connection, tls: { enabled: true, trust: { source: 'pem', caPem: 'PEM' } } },
    }
    expect(withMqttTlsEnabled(pem, true).connection.tls).toEqual(pem.connection.tls)
  })
})

describe('mqttCredentialRequirement', () => {
  it('needs nothing for anonymous and names the method otherwise', () => {
    const base = createDefaultMqttIntegration()
    expect(mqttCredentialRequirement(base)).toEqual({ required: false })
    expect(mqttCredentialRequirement({ ...base, authMethod: 'username_password' })).toEqual({
      required: true,
      method: 'username_password',
    })
    expect(mqttCredentialRequirement({ ...base, authMethod: 'client_certificate' })).toEqual({
      required: true,
      method: 'client_certificate',
    })
  })
})

describe('toPersistedMqttIntegration', () => {
  const full: MqttProjectIntegrationV1 = {
    ...createDefaultMqttIntegration('c1'),
    enabled: true,
    mode: 'sparkplug_b',
    authMethod: 'username_password',
    connection: {
      host: 'broker.local',
      port: 8883,
      clientId: 'c1',
      tls: { enabled: true, trust: { source: 'pem', caPem: '-----BEGIN CERTIFICATE-----\nX' } },
    },
    generic: { ...createDefaultMqttIntegration().generic, topicPrefix: 'plant/a' },
    selections: [
      {
        source: {
          tokens: [
            { role: 'program', name: 'MAIN' },
            { role: 'variable', name: 'Sensores' },
            { role: 'index', indices: [-3, 0] },
          ],
        },
        topic: 'plant/a/s',
        metricName: 'S[-3,0]',
      },
      { source: { tokens: [{ role: 'variable', name: 'Gone' }] } },
    ],
  }

  it('keeps every modelled field, valid or not', () => {
    expect(toPersistedMqttIntegration(full)).toEqual(full)
  })

  it('drops members the model does not know, at every level', () => {
    const polluted: MqttProjectIntegrationV1 = Object.assign(structuredClone(full), {
      password: SECRET_MARKER,
      credential_ref: { id: SECRET_MARKER },
      connection: Object.assign(structuredClone(full.connection), {
        username: SECRET_MARKER,
        clientKey: SECRET_MARKER,
      }),
      selections: full.selections.map((sel) => Object.assign(structuredClone(sel), { secret: SECRET_MARKER })),
    })
    const persisted = toPersistedMqttIntegration(polluted)
    expect(JSON.stringify(persisted)).not.toContain(SECRET_MARKER)
    expect(persisted).toEqual(full)
  })

  it('returns a deep copy that shares nothing with the input', () => {
    const persisted = toPersistedMqttIntegration(full)
    const firstToken = persisted.selections[0].source.tokens[2]
    if (firstToken.role !== 'index') throw new Error('expected an index token')
    firstToken.indices.push(9)
    const original = full.selections[0].source.tokens[2]
    expect(original.role === 'index' ? original.indices : []).toEqual([-3, 0])
  })

  it('keeps plaintext and system-trust connections as they are', () => {
    const plain = withMqttTlsEnabled(createDefaultMqttIntegration('c1'), false)
    expect(toPersistedMqttIntegration(plain).connection.tls).toEqual({ enabled: false })
    expect(toPersistedMqttIntegration(createDefaultMqttIntegration()).connection.tls).toEqual({
      enabled: true,
      trust: { source: 'system' },
    })
  })

  it('writes optional members only when they are set', () => {
    const minimal = toPersistedMqttIntegration(createDefaultMqttIntegration())
    expect(Object.keys(minimal.generic)).not.toContain('topicPrefix')
    const selection = toPersistedMqttIntegration(full).selections[1]
    expect(Object.keys(selection)).toEqual(['source'])
  })
})

describe('toPersistedServer', () => {
  it('returns a non-MQTT server untouched', () => {
    const modbus = { name: 'm', protocol: 'modbus-tcp', modbusSlaveConfig: { enabled: true } }
    expect(toPersistedServer(modbus)).toBe(modbus)
  })

  it('rebuilds only the MQTT member', () => {
    const integration = createDefaultMqttIntegration('c1')
    const server = {
      name: 'mq',
      protocol: 'mqtt',
      mqttConfig: { ...integration, password: SECRET_MARKER },
    }
    const persisted = toPersistedServer(server)
    expect(persisted.name).toBe('mq')
    expect(JSON.stringify(persisted)).not.toContain(SECRET_MARKER)
    expect(persisted.mqttConfig).toEqual(integration)
  })
})
