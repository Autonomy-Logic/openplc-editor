import { MQTT_IEC_TYPES, type MqttProjectIntegrationV1, type MqttSourceToken } from '../../contract/contract'
import { createDefaultMqttIntegration } from '../../project/model'
import { summarizeMqttSelections } from '../../project/selection-summary'
import { buildMqttSourceTree, type MqttSourceModel, type MqttTreeNode } from '../../project/source-model'
import type { MqttRuntimeCredentialStatus } from '../../runtime/status'
import {
  evaluateMqttCredentialState,
  mqttBindingsEqual,
  mqttCredentialBinding,
  mqttRuntimeBindingMatches,
  mqttTargetKey,
} from '../credential-state'
import { collectMqttEditorIssues, groupMqttIssues } from '../editor-issues'
import {
  MQTT_ERROR_CATEGORY_LABELS,
  MQTT_RUNTIME_STATE_LABELS,
  mqttEncodingLabel,
  mqttIssueSection,
  mqttIssueSelectionIndex,
  mqttMissingReasonText,
  mqttSourceDisplayPath,
  mqttUnsupportedReasonText,
} from '../presentation'
import {
  clearMqttSubtree,
  countMqttSelectedUnder,
  isMqttTokenPrefix,
  mqttSelectedKeys,
  removeMqttSelection,
  selectMqttSubtree,
  setMqttSelectionDestination,
  toggleMqttLeafSelection,
} from '../selection'

const instance = (name: string): MqttSourceToken => ({ role: 'instance', name })
const program = (name: string): MqttSourceToken => ({ role: 'program', name })
const variable = (name: string): MqttSourceToken => ({ role: 'variable', name })
const field = (name: string): MqttSourceToken => ({ role: 'field', name })
const index = (...indices: number[]): MqttSourceToken => ({ role: 'index', indices })

const base = (definition: string, value: string) => ({ definition, value })

const model: MqttSourceModel = {
  instances: [{ name: 'Line1', program: 'Main' }],
  pous: [
    {
      name: 'Main',
      kind: 'program',
      variables: [
        { name: 'Count', class: 'local', type: base('base-type', 'DINT') },
        { name: 'Tank', class: 'local', type: base('user-data-type', 'TankT') },
        {
          name: 'Levels',
          class: 'local',
          type: {
            definition: 'array',
            value: 'ARRAY',
            data: { baseType: base('base-type', 'INT'), dimensions: [{ dimension: '-2..1' }] },
          },
        },
        {
          name: 'Big',
          class: 'local',
          type: {
            definition: 'array',
            value: 'ARRAY',
            data: { baseType: base('base-type', 'BOOL'), dimensions: [{ dimension: '0..1999' }] },
          },
        },
        { name: 'Mode', class: 'local', type: base('user-data-type', 'ModeE') },
      ],
    },
  ],
  dataTypes: [
    {
      name: 'TankT',
      derivation: 'structure',
      variable: [
        { name: 'Level', type: base('base-type', 'REAL') },
        { name: 'Name', type: base('base-type', 'STRING') },
      ],
    },
    { name: 'ModeE', derivation: 'enumerated' },
  ],
  globalVariables: [],
}

const tree = buildMqttSourceTree(model)
const scope = tree[0]
const child = (name: string): MqttTreeNode => {
  if (scope.kind !== 'scope') throw new Error('scope expected')
  const found = scope.children.find((c) => c.label === name)
  if (!found) throw new Error(`${name} missing`)
  return found
}

const integration = (patch: Partial<MqttProjectIntegrationV1> = {}): MqttProjectIntegrationV1 => ({
  ...createDefaultMqttIntegration('plc-1'),
  ...patch,
})

const COUNT = [instance('Line1'), program('Main'), variable('Count')]

describe('presentation', () => {
  it('names every runtime state, error category and encoding', () => {
    expect(Object.keys(MQTT_RUNTIME_STATE_LABELS)).toHaveLength(7)
    expect(Object.keys(MQTT_ERROR_CATEGORY_LABELS)).toHaveLength(9)
    for (const type of MQTT_IEC_TYPES) {
      expect(mqttEncodingLabel(type, 'generic')).not.toBe('')
      expect(mqttEncodingLabel(type, 'sparkplug_b')).not.toBe('')
    }
    expect(mqttEncodingLabel('LINT', 'generic')).toBe('Decimal string')
    expect(mqttEncodingLabel('WSTRING', 'generic')).toBe('Base64 of UTF-16LE')
    expect(mqttEncodingLabel('ULINT', 'sparkplug_b')).toBe('UInt64')
    expect(mqttEncodingLabel('TIME', 'sparkplug_b')).toBe('Int64 (ns duration)')
  })

  it('explains unsupported and missing references, falling back for unknown details', () => {
    expect(mqttUnsupportedReasonText('type_enumeration')).toBe('Enumerations cannot be published.')
    expect(mqttMissingReasonText('member_missing')).toBe('The variable or field no longer exists.')
    expect(mqttMissingReasonText('not_a_leaf')).toContain('not a single value')
    expect(mqttMissingReasonText('declaration_mismatch')).toBe('The reference does not match the program.')
    expect(mqttMissingReasonText('toString')).toBe('The reference does not match the program.')
    expect(mqttMissingReasonText(undefined)).toBe('The reference does not match the program.')
  })

  it('shows source paths with the original indices', () => {
    expect(
      mqttSourceDisplayPath([instance('Line1'), program('Main'), variable('Grid'), index(-1, 3), field('V')]),
    ).toBe('Line1.Main.Grid[-1,3].V')
    expect(mqttSourceDisplayPath([])).toBe('')
  })

  it('maps issue pointers to editor sections and selections', () => {
    expect(mqttIssueSection('/connection/host')).toBe('connection')
    expect(mqttIssueSection('/connection/tls/trust/caPem')).toBe('security')
    expect(mqttIssueSection('/connection/tls/enabled')).toBe('security')
    expect(mqttIssueSection('/authMethod')).toBe('security')
    expect(mqttIssueSection('/generic/qos')).toBe('publication')
    expect(mqttIssueSection('/sparkplug/groupId')).toBe('publication')
    expect(mqttIssueSection('/selections/3/topic')).toBe('variables')
    expect(mqttIssueSection('/enabled')).toBe('general')
    expect(mqttIssueSelectionIndex('/selections/12/source/tokens')).toBe(12)
    expect(mqttIssueSelectionIndex('/selections/0')).toBe(0)
    expect(mqttIssueSelectionIndex('/selections')).toBeNull()
    expect(mqttIssueSelectionIndex('/selections/x')).toBeNull()
  })
})

describe('selection', () => {
  it('compares token paths exactly, indices included', () => {
    expect(isMqttTokenPrefix(COUNT.slice(0, 2), COUNT)).toBe(true)
    expect(isMqttTokenPrefix(COUNT, COUNT.slice(0, 2))).toBe(false)
    expect(isMqttTokenPrefix([instance('Line1'), index(1)], [instance('Line1'), index(1, 2)])).toBe(false)
    expect(isMqttTokenPrefix([index(1)], [variable('x')])).toBe(false)
    expect(isMqttTokenPrefix([variable('x')], [field('x')])).toBe(false)
    expect(isMqttTokenPrefix([variable('x'), index(-1, 2)], [variable('x'), index(-1, 2), field('y')])).toBe(true)
    expect(isMqttTokenPrefix([variable('x'), index(-1, 2)], [variable('x'), index(-1, 3)])).toBe(false)
  })

  it('toggles one leaf on and off without touching the others', () => {
    const on = toggleMqttLeafSelection(integration(), COUNT)
    if (!on.ok) throw new Error('expected change')
    expect(on.integration.selections).toEqual([{ source: { tokens: COUNT } }])
    expect(on.integration.selections[0].source.tokens).not.toBe(COUNT)
    const off = toggleMqttLeafSelection(on.integration, COUNT)
    expect(off.ok && off.integration.selections).toEqual([])
  })

  it('refuses a leaf beyond the limit', () => {
    const full = integration({
      selections: Array.from({ length: 1000 }, (_, i) => ({ source: { tokens: [...COUNT, index(i)] } })),
    })
    expect(toggleMqttLeafSelection(full, COUNT)).toEqual({
      ok: false,
      message: 'Selecting 1 more leaves would exceed the limit of 1000 (1000 already selected).',
    })
  })

  it('selects a structure subset and an array with negative bounds, keeping original indices', () => {
    const tank = selectMqttSubtree(model, integration(), child('Tank'))
    if (!tank.ok) throw new Error('expected change')
    expect(tank.changed).toBe(2)
    const levels = selectMqttSubtree(model, tank.integration, child('Levels'))
    if (!levels.ok) throw new Error('expected change')
    expect(levels.integration.selections.map((s) => mqttSourceDisplayPath(s.source.tokens))).toEqual([
      'Line1.Main.Tank.Level',
      'Line1.Main.Tank.Name',
      'Line1.Main.Levels[-2]',
      'Line1.Main.Levels[-1]',
      'Line1.Main.Levels[0]',
      'Line1.Main.Levels[1]',
    ])
    const again = selectMqttSubtree(model, levels.integration, child('Levels'))
    expect(again.ok && again.changed).toBe(0)
    expect(countMqttSelectedUnder(levels.integration, child('Levels').tokens)).toBe(4)
    expect(mqttSelectedKeys(levels.integration).size).toBe(6)
  })

  it('refuses a subtree that would pass the limit, as a whole', () => {
    expect(selectMqttSubtree(model, integration(), child('Big'))).toEqual({
      ok: false,
      message: 'Selecting 2000 more leaves would exceed the limit of 1000 (0 already selected).',
    })
    const nearlyFull = integration({
      selections: Array.from({ length: 999 }, (_, i) => ({ source: { tokens: [...COUNT, index(i)] } })),
    })
    const refused = selectMqttSubtree(model, nearlyFull, child('Tank'))
    expect(refused).toEqual({
      ok: false,
      message: 'Selecting 2 more leaves would exceed the limit of 1000 (999 already selected).',
    })
    // A stale selection under the node lowers the cheap bound; the exact count still refuses.
    const staleUnderTank = integration({
      selections: [...nearlyFull.selections.slice(1), { source: { tokens: [...child('Tank').tokens, field('Gone')] } }],
    })
    expect(selectMqttSubtree(model, staleUnderTank, child('Tank'))).toEqual({
      ok: false,
      message: 'Selecting 2 more leaves would exceed the limit of 1000 (999 already selected).',
    })
  })

  it('clears a subtree, removes one selection and sets destinations per mode', () => {
    expect(selectMqttSubtree(model, integration(), scope).ok).toBe(false)
    const steps = [
      (i: MqttProjectIntegrationV1) => toggleMqttLeafSelection(i, COUNT),
      (i: MqttProjectIntegrationV1) => selectMqttSubtree(model, i, child('Tank')),
      (i: MqttProjectIntegrationV1) => selectMqttSubtree(model, i, child('Levels')),
    ]
    const selected = steps.reduce<ReturnType<typeof toggleMqttLeafSelection>>(
      (current, step) => (current.ok ? step(current.integration) : current),
      { ok: true, integration: integration(), changed: 0 },
    )
    if (!selected.ok) throw new Error('expected selection')
    expect(selected.integration.selections).toHaveLength(7)
    const cleared = clearMqttSubtree(selected.integration, child('Tank').tokens)
    expect(cleared.ok && cleared.changed).toBe(2)
    expect(removeMqttSelection(selected.integration, 0).selections).toHaveLength(6)

    const withTopic = setMqttSelectionDestination(selected.integration, 0, 'plant/count')
    expect(withTopic.selections[0]).toEqual({ source: selected.integration.selections[0].source, topic: 'plant/count' })
    const sparkplug = setMqttSelectionDestination({ ...withTopic, mode: 'sparkplug_b' }, 0, 'Count metric')
    expect(sparkplug.selections[0]).toMatchObject({ topic: 'plant/count', metricName: 'Count metric' })
    const cleared2 = setMqttSelectionDestination(sparkplug, 0, '')
    expect(cleared2.selections[0]).toEqual({ source: selected.integration.selections[0].source, topic: 'plant/count' })
    const genericCleared = setMqttSelectionDestination({ ...sparkplug, mode: 'generic' }, 0, '')
    expect(genericCleared.selections[0]).toEqual({
      source: selected.integration.selections[0].source,
      metricName: 'Count metric',
    })
    expect(setMqttSelectionDestination(selected.integration, 1, 'x').selections[0]).toBe(
      selected.integration.selections[0],
    )
  })
})

describe('credential state', () => {
  const secured = integration({
    authMethod: 'username_password',
    connection: { ...integration().connection, host: 'broker.plant.local' },
  })
  const binding = mqttCredentialBinding(secured)
  const runtimeActive = (patch: Partial<MqttRuntimeCredentialStatus['binding']> = {}): MqttRuntimeCredentialStatus => ({
    id: '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f',
    revision: 3,
    method: 'username_password',
    binding: {
      host: 'broker.plant.local',
      port: 8883,
      tls_enabled: true,
      client_id: 'plc-1',
      method: 'username_password',
      ...patch,
    },
    usernameSet: true,
    updatedAt: '2026-10-08T09:00:00.000Z',
    updatedBy: 'admin',
  })

  it('derives target keys from the selected device or the runtime address', () => {
    expect(
      mqttTargetKey({ selectedDevice: { orchestratorId: 'o1', deviceId: 'd1' }, runtimeIpAddress: '1.2.3.4' }),
    ).toBe('device:o1/d1')
    expect(mqttTargetKey({ selectedDevice: null, runtimeIpAddress: ' 10.0.0.2 ' })).toBe('address:10.0.0.2')
    expect(mqttTargetKey({ runtimeIpAddress: '' })).toBeNull()
    expect(mqttTargetKey({})).toBeNull()
  })

  it('binds a credential to host, port, TLS, client ID and method', () => {
    expect(mqttCredentialBinding(integration())).toBeNull()
    expect(binding).toEqual({
      host: 'broker.plant.local',
      port: 8883,
      tlsEnabled: true,
      clientId: 'plc-1',
      method: 'username_password',
    })
    if (binding === null) throw new Error('binding expected')
    for (const patch of [{ host: 'x' }, { port: 1 }, { tlsEnabled: false }, { clientId: 'y' }] as const) {
      expect(mqttBindingsEqual(binding, { ...binding, ...patch })).toBe(false)
    }
    expect(mqttBindingsEqual(binding, { ...binding, method: 'client_certificate' })).toBe(false)
    expect(mqttRuntimeBindingMatches(binding, runtimeActive().binding)).toBe(true)
    expect(mqttRuntimeBindingMatches(binding, runtimeActive({ client_id: 'other' }).binding)).toBe(false)
  })

  it('tells where the credential comes from, or why there is none', () => {
    if (binding === null) throw new Error('binding expected')
    type Local = Parameters<typeof evaluateMqttCredentialState>[0]['local']
    const state = (
      local: Local,
      active: MqttRuntimeCredentialStatus | null = null,
      targetKey: string | null = 'address:1.2.3.4',
      target: MqttProjectIntegrationV1 = secured,
    ) => evaluateMqttCredentialState({ integration: target, targetKey, local, runtimeActive: active }).kind
    expect(state(null, null, null, integration())).toBe('not_required')
    expect(state({ present: false }, null, null)).toBe('no_target')
    expect(state(null)).toBe('loading')
    expect(state({ present: false })).toBe('missing')
    expect(state({ present: true, method: 'username_password', binding })).toBe('local')
    expect(state({ present: true, binding: { ...binding, host: 'old' } })).toBe('binding_mismatch')
    expect(state({ present: true })).toBe('binding_mismatch')
    expect(state({ present: false }, runtimeActive())).toBe('runtime')
    expect(state({ present: false }, runtimeActive({ host: 'elsewhere' }))).toBe('missing')
  })
})

describe('editor issues', () => {
  const enabled = integration({
    enabled: true,
    authMethod: 'username_password',
    connection: { ...integration().connection, host: 'bad host' },
    selections: [{ source: { tokens: [instance('Line1'), program('Main'), variable('Gone')] } }],
  })
  const summary = summarizeMqttSelections(enabled, model)

  it('collects target, integration, selection and credential issues once each', () => {
    const servers = [
      { name: 'A', protocol: 'mqtt', mqttConfig: enabled },
      { name: 'B', protocol: 'mqtt', mqttConfig: enabled },
    ]
    const issues = collectMqttEditorIssues({
      serverName: 'B',
      integration: enabled,
      servers,
      target: { mqttClient: false },
      summary: { ...summary, issues: [...summary.issues, ...summary.issues] },
      credential: { kind: 'missing' },
    })
    expect(issues.map((i) => i.code)).toEqual([
      'config_multiple_enabled',
      'project_target_unsupported',
      'project_host_invalid',
      'project_selection_unresolved',
      'config_credential_missing',
    ])
    expect(issues.every((i) => !('server' in i))).toBe(true)
    const grouped = groupMqttIssues(issues)
    expect(grouped.general.map((i) => i.code)).toEqual(['config_multiple_enabled', 'project_target_unsupported'])
    expect(grouped.connection.map((i) => i.code)).toEqual(['project_host_invalid'])
    expect(grouped.variables.map((i) => i.code)).toEqual(['project_selection_unresolved'])
    expect(grouped.security.map((i) => i.code)).toEqual(['config_credential_missing'])
    expect(grouped.publication).toEqual([])
  })

  it.each([
    [{ kind: 'no_target' } as const, ['config_credential_missing']],
    [{ kind: 'binding_mismatch', presence: { present: true } } as const, ['config_credential_binding_mismatch']],
    [{ kind: 'loading' } as const, []],
    [{ kind: 'not_required' } as const, []],
  ])('reports credential state %p', (credential, codes) => {
    const issues = collectMqttEditorIssues({
      serverName: 'A',
      integration: { ...enabled, connection: { ...enabled.connection, host: 'ok.host' }, selections: [] },
      servers: undefined,
      target: { mqttClient: true },
      summary: { ...summary, issues: [] },
      credential,
    })
    expect(issues.map((i) => i.code).filter((c) => c.startsWith('config_credential'))).toEqual(codes)
  })
})
