import hals from '../../../../../backend/shared/firmware/hals.json'
import {
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from '../../../../../middleware/shared/utils/target-capabilities'
import { resolveTargetCapabilities } from '../../../../../middleware/shared/utils/target-capabilities/resolve'
import type { MqttProjectIntegrationV1, MqttProjectSelectionV1, MqttSourceToken } from '../../contract/contract'
import { createDefaultMqttIntegration } from '../model'
import {
  isValidMqttHost,
  mqttSelectionDestination,
  validateMqttCredentialPresence,
  validateMqttIntegration,
  validateMqttServers,
} from '../validate'

const leaf = (...names: string[]): MqttProjectSelectionV1 => ({
  source: {
    tokens: names.map((name, i): MqttSourceToken => ({ role: i === 0 ? 'program' : 'variable', name })),
  },
})

const valid = (overrides: Partial<MqttProjectIntegrationV1> = {}): MqttProjectIntegrationV1 => {
  const base = createDefaultMqttIntegration('plc-linha1')
  return {
    ...base,
    enabled: true,
    connection: { ...base.connection, host: 'broker.example.com' },
    selections: [leaf('MAIN', 'Counter'), leaf('MAIN', 'Toggle')],
    ...overrides,
  }
}

const codes = (integration: MqttProjectIntegrationV1) =>
  validateMqttIntegration(integration).map((issue) => [issue.code, issue.pointer])

describe('validateMqttIntegration', () => {
  it('accepts a complete generic and Sparkplug integration', () => {
    expect(codes(valid())).toEqual([])
    expect(codes(valid({ mode: 'sparkplug_b' }))).toEqual([])
  })

  it('accepts an integration that is still disabled and empty', () => {
    const draft = { ...createDefaultMqttIntegration('c1'), connection: { ...valid().connection } }
    expect(codes(draft)).toEqual([])
  })

  it.each([
    ['', false],
    ['broker', true],
    ['10.0.0.12', true],
    ['[fe80::1]', true],
    ['under_score.local', false],
    ['-bad.example', false],
    [`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`, true],
    [`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`, false],
  ])('host %p valid=%p', (host, expected) => {
    expect(isValidMqttHost(host)).toBe(expected)
  })

  it('reports connection problems with pointers into the project model', () => {
    const base = valid()
    const broken = valid({
      authMethod: 'client_certificate',
      connection: { host: 'bad host', port: 70000, clientId: '-x', tls: { enabled: false } },
    })
    expect(codes(broken)).toEqual([
      ['project_host_invalid', '/connection/host'],
      ['project_port_invalid', '/connection/port'],
      ['project_client_id_invalid', '/connection/clientId'],
      ['config_tls_required', '/connection/tls/enabled'],
    ])
    expect(codes({ ...base, connection: { ...base.connection, port: 1.5 } })).toEqual([
      ['project_port_invalid', '/connection/port'],
    ])
  })

  it('checks the private CA only when it is the trust source', () => {
    const withCa = (caPem: string) =>
      valid({ connection: { ...valid().connection, tls: { enabled: true, trust: { source: 'pem', caPem } } } })
    expect(codes(withCa('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'))).toEqual([])
    expect(codes(withCa('not a pem'))).toEqual([['project_ca_pem_invalid', '/connection/tls/trust/caPem']])
    expect(codes(withCa(`-----BEGIN CERTIFICATE-----${'A'.repeat(65536)}`))).toEqual([
      ['project_ca_pem_invalid', '/connection/tls/trust/caPem'],
    ])
  })

  it('checks only the interval the current publishing mode uses', () => {
    const generic = valid().generic
    expect(codes(valid({ generic: { ...generic, sampleIntervalMs: 99 } }))).toEqual([
      ['project_interval_invalid', '/generic/sampleIntervalMs'],
    ])
    expect(codes(valid({ generic: { ...generic, sampleIntervalMs: 99, publishMode: 'periodic' } }))).toEqual([])
    expect(codes(valid({ generic: { ...generic, publishMode: 'periodic', publishIntervalMs: 60001 } }))).toEqual([
      ['project_interval_invalid', '/generic/publishIntervalMs'],
    ])
    expect(codes(valid({ generic: { ...generic, sampleIntervalMs: 60000 } }))).toEqual([])
    const sparkplug = valid().sparkplug
    expect(codes(valid({ mode: 'sparkplug_b', sparkplug: { ...sparkplug, sampleIntervalMs: 100.5 } }))).toEqual([
      ['project_interval_invalid', '/sparkplug/sampleIntervalMs'],
    ])
  })

  it('validates the topic prefix and Sparkplug IDs with the shared naming rules', () => {
    const generic = valid().generic
    expect(codes(valid({ generic: { ...generic, topicPrefix: 'plant/line1' } }))).toEqual([])
    const prefixIssue = validateMqttIntegration(valid({ generic: { ...generic, topicPrefix: 'plant/#' } }))
    expect(prefixIssue.map((i) => [i.code, i.detail])).toEqual([['project_topic_prefix_invalid', 'topic_invalid_char']])
    const ids = validateMqttIntegration(
      valid({ mode: 'sparkplug_b', sparkplug: { groupId: 'a/b', edgeNodeId: ' edge', sampleIntervalMs: 100 } }),
    )
    expect(ids.map((i) => [i.code, i.pointer, i.detail])).toEqual([
      ['config_sparkplug_id_invalid', '/sparkplug/groupId', 'node_id_invalid_char'],
      ['config_sparkplug_id_invalid', '/sparkplug/edgeNodeId', 'node_id_outer_whitespace'],
    ])
  })

  it('needs at least one selection only once enabled, and at most 1000', () => {
    expect(codes(valid({ selections: [] }))).toEqual([['config_no_leaves', '/selections']])
    expect(codes(valid({ selections: [], enabled: false }))).toEqual([])
    const many = (count: number) => Array.from({ length: count }, (_, i) => leaf('MAIN', `V${i}`))
    expect(codes(valid({ selections: many(1000) }))).toEqual([])
    expect(codes(valid({ selections: many(1001) }))).toEqual([['config_too_many_leaves', '/selections']])
  })

  it('flags malformed sources without dropping them', () => {
    const selections: MqttProjectSelectionV1[] = [
      { source: { tokens: [{ role: 'variable', name: 'Only' }] } },
      {
        source: {
          tokens: [
            { role: 'index', indices: [1] },
            { role: 'variable', name: 'x' },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: '' },
            { role: 'variable', name: 'x' },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: 'P' },
            { role: 'index', indices: [] },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: 'P' },
            { role: 'index', indices: [2147483648] },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: 'P' },
            { role: 'index', indices: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: 'P' },
            { role: 'variable', name: 'n'.repeat(257) },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: 'P' },
            { role: 'variable', name: 'a\uD800' },
          ],
        },
      },
      {
        source: {
          tokens: [
            { role: 'program', name: '\uDC00b' },
            { role: 'variable', name: 'x' },
          ],
        },
      },
    ]
    const integration = valid({ selections })
    expect(codes(integration)).toEqual(
      selections.map((_, i) => ['project_selection_invalid', `/selections/${i}/source/tokens`]),
    )
    expect(integration.selections).toHaveLength(selections.length)
  })

  it('accepts names with supplementary characters as valid sources', () => {
    const selection = leaf('MAIN', 'Temp\u{1F321}')
    const integration = valid({ selections: [selection] })
    expect(codes(integration)).toEqual([])
    expect(mqttSelectionDestination(integration, selection)).toBe('openplc/plc-linha1/MAIN/Temp%F0%9F%8C%A1')
  })

  it('keeps negative and multi-dimensional indices as valid sources', () => {
    const selection: MqttProjectSelectionV1 = {
      source: {
        tokens: [
          { role: 'instance', name: 'Inst' },
          { role: 'program', name: 'MAIN' },
          { role: 'variable', name: 'Grid' },
          { role: 'index', indices: [-2, 0] },
          { role: 'field', name: 'Value' },
        ],
      },
    }
    const integration = valid({ selections: [selection] })
    expect(codes(integration)).toEqual([])
    expect(mqttSelectionDestination(integration, selection)).toBe('openplc/plc-linha1/Inst/MAIN/Grid/-2,0/Value')
    expect(mqttSelectionDestination({ ...integration, mode: 'sparkplug_b' }, selection)).toBe(
      'Inst.MAIN.Grid[-2,0].Value',
    )
  })

  it('rejects the same leaf selected twice', () => {
    expect(codes(valid({ selections: [leaf('MAIN', 'A'), leaf('MAIN', 'A')] }))).toEqual([
      ['project_selection_duplicate', '/selections/1/source/tokens'],
      ['config_destination_conflict', '/selections/1/topic'],
    ])
  })

  it('uses the explicit destination of the current mode and validates it', () => {
    const selections: MqttProjectSelectionV1[] = [
      { ...leaf('MAIN', 'A'), topic: '$SYS/a', metricName: 'Good' },
      { ...leaf('MAIN', 'B'), topic: 'ok/b', metricName: 'Node Control/Rebirth' },
    ]
    expect(validateMqttIntegration(valid({ selections })).map((i) => [i.code, i.pointer, i.detail])).toEqual([
      ['config_destination_invalid', '/selections/0/topic', 'topic_reserved_prefix'],
    ])
    expect(
      validateMqttIntegration(valid({ mode: 'sparkplug_b', selections })).map((i) => [i.code, i.pointer, i.detail]),
    ).toEqual([['config_destination_invalid', '/selections/1/metricName', 'metric_reserved']])
  })

  it('detects destination collisions with the mode-specific rule', () => {
    const topics: MqttProjectSelectionV1[] = [
      { ...leaf('MAIN', 'A'), topic: 'x/y' },
      { ...leaf('MAIN', 'B'), topic: 'x/Y' },
      { ...leaf('MAIN', 'C'), topic: 'x/y' },
    ]
    expect(validateMqttIntegration(valid({ selections: topics })).map((i) => [i.code, i.pointer, i.detail])).toEqual([
      ['config_destination_conflict', '/selections/2/topic', 'topic_duplicate'],
    ])
    const metrics: MqttProjectSelectionV1[] = [
      { ...leaf('MAIN', 'A'), metricName: 'Straße' },
      { ...leaf('MAIN', 'B'), metricName: 'STRASSE' },
    ]
    expect(
      validateMqttIntegration(valid({ mode: 'sparkplug_b', selections: metrics })).map((i) => [i.code, i.detail]),
    ).toEqual([['config_destination_conflict', 'metric_collision']])
  })

  it('derives default destinations from the custom topic prefix', () => {
    const integration = valid({ generic: { ...valid().generic, topicPrefix: 'plant/line1' } })
    expect(mqttSelectionDestination(integration, leaf('MAIN', 'Válvula'))).toBe('plant/line1/MAIN/V%C3%A1lvula')
    expect(mqttSelectionDestination(integration, { source: { tokens: [] } })).toBeNull()
  })
})

describe('validateMqttServers', () => {
  const server = (name: string, enabled: boolean) => ({
    name,
    protocol: 'mqtt',
    mqttConfig: { ...valid(), enabled },
  })
  const modbus = { name: 'modbus', protocol: 'modbus-tcp' }

  it('accepts one enabled integration and rejects a second', () => {
    expect(validateMqttServers([server('a', true), server('b', false), modbus], RUNTIME_V4_CAPABILITIES)).toEqual([])
    const issues = validateMqttServers(
      [server('a', true), server('b', true), server('c', true)],
      RUNTIME_V4_CAPABILITIES,
    )
    expect(issues.map((i) => [i.server, i.code])).toEqual([
      ['b', 'config_multiple_enabled'],
      ['c', 'config_multiple_enabled'],
    ])
  })

  it('accepts a project without servers', () => {
    expect(validateMqttServers(undefined, RUNTIME_V4_CAPABILITIES)).toEqual([])
  })

  it.each([
    ['Runtime v3', RUNTIME_V3_CAPABILITIES],
    ['Arduino', ARDUINO_CLI_CAPABILITIES],
    ['Simulator', SIMULATOR_CAPABILITIES],
  ])('blocks an enabled integration on %s and keeps it in the project', (_label, caps) => {
    const servers = [server('a', true), server('b', false)]
    expect(validateMqttServers(servers, caps).map((i) => [i.server, i.code])).toEqual([
      ['a', 'project_target_unsupported'],
    ])
    expect(servers).toHaveLength(2)
  })

  it('resolves the capability from the shipped board catalogue, including Runtime v3 inheriting from v4', () => {
    const board = (name: keyof typeof hals) => {
      const entry = hals[name]
      return resolveTargetCapabilities({
        compiler: entry.compiler,
        capabilities: { mqttClient: entry.capabilities.mqttClient },
      }).mqttClient
    }
    expect(board('OpenPLC Runtime v4')).toBe(true)
    expect(board('OpenPLC Runtime v3')).toBe(false)
    expect(board('OpenPLC Simulator')).toBe(false)
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler', vpp: true }).mqttClient).toBe(true)
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli', vpp: true }).mqttClient).toBe(false)
    expect(resolveTargetCapabilities(undefined).mqttClient).toBe(false)
  })
})

describe('validateMqttCredentialPresence', () => {
  it('needs nothing for anonymous authentication', () => {
    expect(validateMqttCredentialPresence(valid(), { present: false })).toEqual([])
  })

  it.each(['username_password', 'client_certificate'] as const)('requires a credential for %s', (authMethod) => {
    const integration = valid({ authMethod })
    expect(validateMqttCredentialPresence(integration, { present: true })).toEqual([])
    const issues = validateMqttCredentialPresence(integration, { present: false })
    expect(issues.map((i) => [i.code, i.pointer])).toEqual([['config_credential_missing', '/authMethod']])
  })
})
