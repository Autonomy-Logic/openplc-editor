import { PLCServerSchema } from '../../../../../backend/shared/types/PLC/open-plc'
import { createDefaultMqttIntegration } from '../model'
import { MqttProjectIntegrationSchema } from '../schema'

const SECRET_MARKER = 'MARKER-SECRET-51d2'

const mqttServer = (mqttConfig: unknown) => ({ name: 'Broker', protocol: 'mqtt', mqttConfig })

describe('MqttProjectIntegrationSchema', () => {
  it('accepts the defaults unchanged', () => {
    const integration = createDefaultMqttIntegration('c1')
    expect(MqttProjectIntegrationSchema.parse(integration)).toEqual(integration)
  })

  it('keeps semantically invalid content so nothing the user entered is lost on load', () => {
    const invalid = {
      ...createDefaultMqttIntegration('bad id with spaces'),
      enabled: true,
      connection: { host: 'not a host!', port: 0, clientId: 'bad id with spaces', tls: { enabled: false } },
      authMethod: 'client_certificate',
      generic: { publishMode: 'periodic', sampleIntervalMs: 5, publishIntervalMs: 999999, qos: 1, retain: true },
      sparkplug: { groupId: 'a/b', edgeNodeId: ' x', sampleIntervalMs: 50 },
      selections: [
        { source: { tokens: [{ role: 'variable', name: 'RemovedVariable' }] }, topic: '$SYS/#' },
        { source: { tokens: [] }, metricName: 'bdSeq' },
        { source: { tokens: [{ role: 'index', indices: [-5] }] } },
      ],
    }
    expect(MqttProjectIntegrationSchema.parse(invalid)).toEqual(invalid)
  })

  it('strips members the model does not define, secrets included', () => {
    const parsed = MqttProjectIntegrationSchema.parse({
      ...createDefaultMqttIntegration('c1'),
      password: SECRET_MARKER,
      credential_ref: { id: SECRET_MARKER, revision: 1, staging_id: null },
      connection: { ...createDefaultMqttIntegration('c1').connection, username: SECRET_MARKER },
    })
    expect(JSON.stringify(parsed)).not.toContain(SECRET_MARKER)
    expect(parsed).toEqual(createDefaultMqttIntegration('c1'))
  })

  it.each([
    ['an unknown format version', { formatVersion: 2 }],
    ['an unknown mode', { mode: 'sparkplug_a' }],
    ['an unknown auth method', { authMethod: 'token' }],
    ['QoS 2', { generic: { ...createDefaultMqttIntegration().generic, qos: 2 } }],
    ['TLS without the enabled flag', { connection: { host: '', port: 1, clientId: 'c', tls: {} } }],
    ['a token with an unknown role', { selections: [{ source: { tokens: [{ role: 'array', name: 'x' }] } }] }],
    ['a fractional index', { selections: [{ source: { tokens: [{ role: 'index', indices: [1.5] }] } }] }],
    ['a port given as a string', { connection: { host: 'h', port: '8883', clientId: 'c', tls: { enabled: false } } }],
  ])('rejects %s', (_label, override) => {
    expect(MqttProjectIntegrationSchema.safeParse({ ...createDefaultMqttIntegration(), ...override }).success).toBe(
      false,
    )
  })
})

describe('PLCServerSchema with MQTT', () => {
  it('reads an MQTT server file', () => {
    const integration = createDefaultMqttIntegration('c1')
    const parsed = PLCServerSchema.parse(mqttServer(integration))
    expect(parsed.protocol).toBe('mqtt')
    expect(parsed.mqttConfig).toEqual(integration)
  })

  it('reads an MQTT server without a configuration, leaving the default to the store', () => {
    expect(PLCServerSchema.parse({ name: 'Broker', protocol: 'mqtt' }).mqttConfig).toBeUndefined()
  })

  it('still reads server files written before MQTT existed, byte for byte the same model', () => {
    const legacy = [
      {
        name: 'modbus',
        protocol: 'modbus-tcp',
        modbusSlaveConfig: { enabled: true, networkInterface: '0.0.0.0', port: 502 },
      },
      {
        name: 's7',
        protocol: 's7comm',
        s7commSlaveConfig: {
          server: {
            enabled: false,
            bindAddress: '0.0.0.0',
            port: 102,
            maxClients: 32,
            workIntervalMs: 100,
            sendTimeoutMs: 3000,
            recvTimeoutMs: 3000,
            pingTimeoutMs: 10000,
            pduSize: 480,
          },
          dataBlocks: [],
        },
      },
    ]
    for (const server of legacy) {
      const parsed = PLCServerSchema.safeParse(server)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data).toEqual(server)
        expect('mqttConfig' in parsed.data).toBe(false)
      }
    }
  })
})
