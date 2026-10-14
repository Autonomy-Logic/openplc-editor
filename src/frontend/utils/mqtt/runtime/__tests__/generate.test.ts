import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import genericFixture from '../../contract/fixtures/runtime-config/valid/generic-on-change-anonymous-plaintext.json'
import type {
  MqttCredentialRef,
  MqttProjectIntegrationV1,
  MqttProjectSelectionV1,
  MqttSourceToken,
} from '../../contract/contract'
import { createDefaultMqttIntegration } from '../../project/model'
import type { MqttSourceModel } from '../../project/source-model'
import type { MqttServerIssue, MqttServerLike } from '../../project/validate'
import {
  formatMqttServerIssue,
  generateMqttRuntimeConfig,
  type GenerateMqttRuntimeConfigInput,
  MqttConfigGenerationError,
} from '../generate'

const FIXTURE_DEBUG_MAP = readFileSync(
  join(__dirname, '..', '..', 'contract', 'fixtures', 'runtime-config', 'debug-map.json'),
  'utf-8',
)
const MD5 = '3f2c9d0e8b7a6f5e4d3c2b1a09f8e7d6'
const instances = [{ name: 'Inst0', program: 'Main' }]

const variable = (name: string): MqttSourceToken => ({ role: 'variable', name })
const field = (name: string): MqttSourceToken => ({ role: 'field', name })
const index = (...indices: number[]): MqttSourceToken => ({ role: 'index', indices })
const select = (...rest: MqttSourceToken[]): MqttProjectSelectionV1 => ({
  source: {
    tokens: [{ role: 'instance', name: 'Inst0' }, { role: 'program', name: 'Main' }, ...rest],
  },
})

const integration = (overrides: Partial<MqttProjectIntegrationV1> = {}): MqttProjectIntegrationV1 => {
  const base = createDefaultMqttIntegration('plc-linha1')
  return {
    ...base,
    enabled: true,
    connection: { ...base.connection, host: 'broker.example.net', port: 1883, tls: { enabled: false } },
    selections: [
      select(variable('Motor1'), field('Speed')),
      select(variable('Motor2'), field('Speed')),
      select(variable('Temps'), index(-2)),
    ],
    ...overrides,
  }
}

const server = (name: string, config: MqttProjectIntegrationV1 | undefined, protocol = 'mqtt'): MqttServerLike => ({
  name,
  protocol,
  ...(config ? { mqttConfig: config } : {}),
})

const input = (
  config: MqttProjectIntegrationV1,
  overrides: Partial<GenerateMqttRuntimeConfigInput> = {},
): GenerateMqttRuntimeConfigInput => ({
  servers: [server('broker', config)],
  target: { mqttClient: true },
  debugMapContent: FIXTURE_DEBUG_MAP,
  instances,
  ...overrides,
})

const issuesOf = (run: () => unknown): Array<Pick<MqttServerIssue, 'server' | 'code' | 'pointer' | 'detail'>> => {
  try {
    run()
  } catch (error) {
    if (!(error instanceof MqttConfigGenerationError)) throw error
    return error.issues.map(({ server: s, code, pointer, detail }) => ({
      server: s,
      code,
      pointer,
      ...(detail !== undefined ? { detail } : {}),
    }))
  }
  throw new Error('generation did not fail')
}

const REF: MqttCredentialRef = {
  id: '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f',
  revision: 4,
  staging_id: '0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70',
}

describe('generateMqttRuntimeConfig — absence', () => {
  it('returns null without MQTT servers, with only disabled ones, or without a config', () => {
    expect(generateMqttRuntimeConfig(input(integration(), { servers: undefined }))).toBeNull()
    expect(
      generateMqttRuntimeConfig(input(integration(), { servers: [server('m', undefined, 'modbus-tcp')] })),
    ).toBeNull()
    expect(generateMqttRuntimeConfig(input(integration({ enabled: false })))).toBeNull()
    expect(generateMqttRuntimeConfig(input(integration(), { servers: [server('m', undefined)] }))).toBeNull()
  })

  it('does not validate a disabled integration, even an invalid one', () => {
    const broken = integration({ enabled: false, selections: [select(variable('Gone'))] })
    expect(generateMqttRuntimeConfig(input(broken, { debugMapContent: '' }))).toBeNull()
  })
})

describe('generateMqttRuntimeConfig — generic', () => {
  it('produces the C0 generic fixture leaves from project selections resolved against the debug map', () => {
    const result = generateMqttRuntimeConfig(input(integration()))
    if (result === null) throw new Error('config expected')
    expect(result.server).toBe('broker')
    expect(result.leafCount).toBe(3)
    expect(result.birthUpperBoundBytes).toBeNull()
    // Program-scoped tokens include the program, so default topics include it too.
    const expectedLeaves = genericFixture.leaves.slice(0, 3).map((l) => ({
      ...l,
      source: {
        ...l.source,
        tokens: [l.source.tokens[0], { role: 'program', name: 'Main' }, ...l.source.tokens.slice(1)],
      },
      destination: l.destination.replace('/Inst0/', '/Inst0/Main/'),
    }))
    expect(result.config).toEqual({ ...genericFixture, leaves: expectedLeaves })
    expect(result.content).toBe(`${JSON.stringify(result.config, null, 2)}\n`)
    expect(Object.keys(JSON.parse(result.content) as object)).toEqual([
      'contract',
      'format_version',
      'enabled',
      'mode',
      'program',
      'connection',
      'auth',
      'generic',
      'leaves',
    ])
  })

  it('writes periodic publication, private CA and explicit topics', () => {
    const config = integration({
      connection: {
        host: 'broker.example.net',
        port: 8883,
        clientId: 'plc-linha1',
        tls: {
          enabled: true,
          trust: { source: 'pem', caPem: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n' },
        },
      },
      generic: { ...integration().generic, publishMode: 'periodic', publishIntervalMs: 1000, qos: 1, retain: true },
      selections: [{ ...select(variable('V_LINT')), topic: 'plant/line1/lint' }],
    })
    const result = generateMqttRuntimeConfig(input(config))
    expect(result?.config).toMatchObject({
      connection: {
        port: 8883,
        tls: {
          enabled: true,
          trust: { source: 'pem', ca_pem: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n' },
        },
      },
      generic: { publish_mode: 'periodic', publish_interval_ms: 1000, qos: 1, retain: true },
      leaves: [{ destination: 'plant/line1/lint', iec_type: 'LINT', size: 8, address: { arr: 0, elem: 7 } }],
    })
    const tlsSystem = generateMqttRuntimeConfig(
      input(integration({ connection: { ...config.connection, tls: { enabled: true, trust: { source: 'system' } } } })),
    )
    expect(tlsSystem?.config.connection.tls).toEqual({ enabled: true, trust: { source: 'system' } })
  })

  it('accepts 1000 leaves and refuses 1001', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => select(variable('Big'), index(i)))
    expect(generateMqttRuntimeConfig(input(integration({ selections: many(1000) })))?.leafCount).toBe(1000)
    expect(issuesOf(() => generateMqttRuntimeConfig(input(integration({ selections: many(1001) }))))).toContainEqual({
      server: 'broker',
      code: 'config_too_many_leaves',
      pointer: '/selections',
    })
  })

  it('follows the md5 of the program it is generated for', () => {
    const recompiled = FIXTURE_DEBUG_MAP.replace(MD5, 'a'.repeat(32))
    expect(generateMqttRuntimeConfig(input(integration(), { debugMapContent: recompiled }))?.config.program.md5).toBe(
      'a'.repeat(32),
    )
  })
})

describe('generateMqttRuntimeConfig — Sparkplug', () => {
  const sparkplug = (selections: MqttProjectSelectionV1[]) =>
    integration({
      mode: 'sparkplug_b',
      sparkplug: { groupId: 'Plant 1', edgeNodeId: 'plc-linha1', sampleIntervalMs: 100 },
      selections,
    })

  it('writes the Sparkplug section, default metric names and the birth bound', () => {
    const result = generateMqttRuntimeConfig(
      input(sparkplug([select(variable('V_WSTRING')), select(variable('Temps'), index(-1))])),
    )
    expect(result?.config).toMatchObject({
      mode: 'sparkplug_b',
      sparkplug: { group_id: 'Plant 1', edge_node_id: 'plc-linha1', sample_interval_ms: 100 },
      leaves: [
        { destination: 'Inst0.Main.V_WSTRING', iec_type: 'WSTRING', size: 253 },
        { destination: 'Inst0.Main.Temps[-1]', iec_type: 'INT', size: 2 },
      ],
    })
    expect(result?.config).not.toHaveProperty('generic')
    expect(result?.birthUpperBoundBytes).toBeGreaterThan(0)
  })

  it('refuses a birth message over 256 KiB without dropping metrics', () => {
    const selections = Array.from({ length: 1000 }, (_, i) => ({
      ...select(variable('Big'), index(i)),
      metricName: `${String(i).padStart(4, '0')}${'n'.repeat(508)}`,
    }))
    expect(issuesOf(() => generateMqttRuntimeConfig(input(sparkplug(selections))))).toEqual([
      { server: 'broker', code: 'config_payload_too_large', pointer: '/selections' },
    ])
  })
})

describe('generateMqttRuntimeConfig — refusals', () => {
  it('refuses two enabled integrations and an incompatible target', () => {
    expect(
      issuesOf(() =>
        generateMqttRuntimeConfig(
          input(integration(), { servers: [server('a', integration()), server('b', integration())] }),
        ),
      ),
    ).toEqual([{ server: 'b', code: 'config_multiple_enabled', pointer: '/enabled' }])
    expect(issuesOf(() => generateMqttRuntimeConfig(input(integration(), { target: { mqttClient: false } })))).toEqual([
      { server: 'broker', code: 'project_target_unsupported', pointer: '/enabled' },
    ])
  })

  it('blocks on a renamed or removed variable until the selection is repaired', () => {
    const renamed = integration({
      selections: [select(variable('Motor9'), field('Speed')), select(variable('Motor1'))],
    })
    expect(issuesOf(() => generateMqttRuntimeConfig(input(renamed)))).toEqual([
      {
        server: 'broker',
        code: 'project_selection_unresolved',
        pointer: '/selections/0/source/tokens',
        detail: 'leaf_missing',
      },
      {
        server: 'broker',
        code: 'project_selection_unresolved',
        pointer: '/selections/1/source/tokens',
        detail: 'not_a_leaf',
      },
    ])
    const repaired = integration({ selections: [select(variable('Motor2'), field('Speed'))] })
    expect(generateMqttRuntimeConfig(input(repaired))?.leafCount).toBe(1)
  })

  it('does not reuse selections when the instance runs another program', () => {
    expect(
      issuesOf(() =>
        generateMqttRuntimeConfig(input(integration(), { instances: [{ name: 'Inst0', program: 'Other' }] })),
      ),
    ).toEqual(
      [0, 1, 2].map((i) => ({
        server: 'broker',
        code: 'project_selection_unresolved',
        pointer: `/selections/${i}/source/tokens`,
        detail: 'program_mismatch',
      })),
    )
  })

  it('refuses the same value selected twice under different spellings', () => {
    const twice = integration({
      selections: [
        select(variable('Motor1'), field('Speed')),
        { ...select(variable('MOTOR1'), field('SPEED')), topic: 'x/y' },
      ],
    })
    expect(issuesOf(() => generateMqttRuntimeConfig(input(twice)))).toEqual([
      { server: 'broker', code: 'config_leaf_duplicate', pointer: '/selections/1/source/tokens' },
    ])
  })

  it('refuses compiled types and sizes outside the contract', () => {
    const map = JSON.stringify({
      version: 2,
      md5: MD5,
      leaves: [
        { arrayIdx: 0, elemIdx: 0, path: 'INST0.X', type: '__XWORD', size: 8 },
        { arrayIdx: 0, elemIdx: 1, path: 'INST0.S', type: 'STRING', size: 81 },
      ],
    })
    const config = integration({ selections: [select(variable('X')), select(variable('S'))] })
    expect(issuesOf(() => generateMqttRuntimeConfig(input(config, { debugMapContent: map })))).toEqual([
      {
        server: 'broker',
        code: 'config_type_unsupported',
        pointer: '/selections/0/source/tokens',
        detail: 'type_unsupported',
      },
      { server: 'broker', code: 'config_size_mismatch', pointer: '/selections/1/source/tokens' },
    ])
  })

  it('refuses an unusable debug map', () => {
    expect(issuesOf(() => generateMqttRuntimeConfig(input(integration(), { debugMapContent: '' })))).toEqual([
      { server: 'broker', code: 'project_program_invalid', pointer: '' },
    ])
  })

  it('reports project issues before touching the program', () => {
    expect(
      issuesOf(() =>
        generateMqttRuntimeConfig(
          input(integration({ connection: { ...integration().connection, host: '' } }), { debugMapContent: '' }),
        ),
      ),
    ).toEqual([{ server: 'broker', code: 'project_host_invalid', pointer: '/connection/host' }])
  })

  it('refuses a configuration larger than the runtime accepts', () => {
    const fields = Array.from({ length: 60 }, (_, i) => `F${i}${'x'.repeat(57)}`)
    const leaves = Array.from({ length: 1000 }, (_, i) => ({
      arrayIdx: 0,
      elemIdx: i,
      path: ['INST0', `V${i}`, ...fields].join('.').toUpperCase(),
      type: 'BOOL',
      size: 1,
    }))
    const selections = Array.from({ length: 1000 }, (_, i) => ({
      ...select(variable(`V${i}`), ...fields.map(field)),
      topic: `t/${i}`,
    }))
    const map = JSON.stringify({ version: 2, md5: MD5, leaves })
    expect(
      issuesOf(() => generateMqttRuntimeConfig(input(integration({ selections }), { debugMapContent: map }))),
    ).toEqual([{ server: 'broker', code: 'config_too_large', pointer: '/selections' }])
  })
})

describe('generateMqttRuntimeConfig — declarations', () => {
  const declared = (type: { definition: string; value: string }): MqttSourceModel => ({
    instances,
    pous: [{ name: 'Main', kind: 'program', variables: [{ name: 'V_INT', class: 'local', type }] }],
    dataTypes: [{ name: 'Color', derivation: 'enumerated' }],
    globalVariables: [],
  })
  const one = integration({ selections: [select(variable('V_INT'))] })

  it('refuses an enumeration the debug map flattens to INT', () => {
    expect(
      issuesOf(() =>
        generateMqttRuntimeConfig(
          input(one, { sourceModel: declared({ definition: 'user-data-type', value: 'Color' }) }),
        ),
      ),
    ).toEqual([
      {
        server: 'broker',
        code: 'config_type_unsupported',
        pointer: '/selections/0/source/tokens',
        detail: 'type_enumeration',
      },
    ])
  })

  it('accepts matching declarations and refuses ones that disagree with the compiled program', () => {
    expect(
      generateMqttRuntimeConfig(input(one, { sourceModel: declared({ definition: 'base-type', value: 'INT' }) }))
        ?.leafCount,
    ).toBe(1)
    expect(
      issuesOf(() =>
        generateMqttRuntimeConfig(input(one, { sourceModel: declared({ definition: 'base-type', value: 'DINT' }) })),
      ),
    ).toEqual([
      {
        server: 'broker',
        code: 'project_selection_unresolved',
        pointer: '/selections/0/source/tokens',
        detail: 'declaration_mismatch',
      },
    ])
    expect(
      issuesOf(() =>
        generateMqttRuntimeConfig(
          input(one, { sourceModel: { ...declared({ definition: 'base-type', value: 'INT' }), pous: [] } }),
        ),
      ),
    ).toEqual([
      {
        server: 'broker',
        code: 'project_selection_unresolved',
        pointer: '/selections/0/source/tokens',
        detail: 'declaration_mismatch',
      },
    ])
  })

  it('defers to the debug map for library blocks whose definition is not loaded', () => {
    const timer = integration({ selections: [select(variable('Timer1'), field('ET'))] })
    const model: MqttSourceModel = {
      instances,
      pous: [
        {
          name: 'Main',
          kind: 'program',
          variables: [{ name: 'Timer1', type: { definition: 'derived', value: 'TON' } }],
        },
      ],
      dataTypes: [],
      globalVariables: [],
    }
    expect(generateMqttRuntimeConfig(input(timer, { sourceModel: model }))?.config.leaves[0]).toMatchObject({
      iec_type: 'TIME',
      address: { arr: 0, elem: 27 },
    })
  })
})

describe('generateMqttRuntimeConfig — credentials', () => {
  const password = integration({ authMethod: 'username_password' })

  it('refuses a secret method without a runtime credential reference', () => {
    expect(issuesOf(() => generateMqttRuntimeConfig(input(password)))).toEqual([
      { server: 'broker', code: 'config_credential_missing', pointer: '/authMethod' },
    ])
    expect(issuesOf(() => generateMqttRuntimeConfig(input(password, { credentialRef: null })))).toEqual([
      { server: 'broker', code: 'config_credential_missing', pointer: '/authMethod' },
    ])
  })

  it('writes the reference it is given and nothing secret', () => {
    const result = generateMqttRuntimeConfig(input(password, { credentialRef: REF }))
    expect(result?.config.auth).toEqual({ method: 'username_password', credential_ref: REF })
    const reopened = generateMqttRuntimeConfig(input(password, { credentialRef: { ...REF, staging_id: null } }))
    expect(reopened?.config.auth).toEqual({ method: 'username_password', credential_ref: { ...REF, staging_id: null } })
  })

  it.each<[string, MqttCredentialRef]>([
    ['id', { ...REF, id: 'not-a-uuid' }],
    ['revision', { ...REF, revision: 0 }],
    ['staging id', { ...REF, staging_id: 'x' }],
  ])('refuses a malformed reference (%s)', (_label, ref) => {
    expect(issuesOf(() => generateMqttRuntimeConfig(input(password, { credentialRef: ref })))).toEqual([
      { server: 'broker', code: 'config_credential_missing', pointer: '/authMethod', detail: 'credential_ref_invalid' },
    ])
  })

  it('ignores a reference for anonymous access', () => {
    expect(generateMqttRuntimeConfig(input(integration(), { credentialRef: REF }))?.config.auth).toEqual({
      method: 'anonymous',
    })
  })
})

describe('MqttConfigGenerationError', () => {
  it('lists every issue in its message', () => {
    const error = new MqttConfigGenerationError([
      { server: 's', code: 'config_no_leaves', pointer: '/selections', message: 'Select at least one variable.' },
      {
        server: 's',
        code: 'config_destination_invalid',
        pointer: '/selections/0/topic',
        message: 'Topic is not valid.',
        detail: 'topic_empty',
      },
    ])
    expect(error.name).toBe('MqttConfigGenerationError')
    expect(error.message.split('\n')).toEqual([
      'MQTT "s": Select at least one variable. [config_no_leaves at /selections]',
      'MQTT "s": Topic is not valid. [config_destination_invalid/topic_empty at /selections/0/topic]',
    ])
    expect(formatMqttServerIssue(error.issues[0])).toBe(error.message.split('\n')[0])
  })
})
