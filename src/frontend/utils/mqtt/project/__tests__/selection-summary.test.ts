import type { MqttProjectIntegrationV1, MqttProjectSelectionV1, MqttSourceToken } from '../../contract/contract'
import { sparkplugBirthUpperBound } from '../../runtime/birth-size'
import { createDefaultMqttIntegration } from '../model'
import { summarizeMqttSelections } from '../selection-summary'
import type { MqttSourceModel } from '../source-model'

const model: MqttSourceModel = {
  instances: [{ name: 'I0', program: 'Main' }],
  pous: [
    {
      name: 'Main',
      kind: 'program',
      variables: [
        { name: 'Counter', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'Mode', type: { definition: 'user-data-type', value: 'Color' } },
        { name: 'P', type: { definition: 'user-data-type', value: 'Point' } },
        { name: 'Timer', type: { definition: 'derived', value: 'TON' } },
        {
          name: 'Big',
          type: {
            definition: 'array',
            value: 'ARRAY',
            data: { baseType: { definition: 'base-type', value: 'LREAL' }, dimensions: [{ dimension: '0..999' }] },
          },
        },
      ],
    },
  ],
  dataTypes: [
    { name: 'Color', derivation: 'enumerated' },
    {
      name: 'Point',
      derivation: 'structure',
      variable: [{ name: 'X', type: { definition: 'base-type', value: 'REAL' } }],
    },
  ],
  globalVariables: [],
}

const select = (...rest: MqttSourceToken[]): MqttProjectSelectionV1 => ({
  source: { tokens: [{ role: 'instance', name: 'I0' }, { role: 'program', name: 'Main' }, ...rest] },
})
const variable = (name: string): MqttSourceToken => ({ role: 'variable', name })

const integration = (
  selections: MqttProjectSelectionV1[],
  mode: MqttProjectIntegrationV1['mode'] = 'generic',
): MqttProjectIntegrationV1 => ({ ...createDefaultMqttIntegration('plc1'), enabled: true, mode, selections })

describe('summarizeMqttSelections', () => {
  it('counts resolved leaves and lists actionable issues for the others', () => {
    const summary = summarizeMqttSelections(
      integration([
        select(variable('Counter')),
        select(variable('P'), { role: 'field', name: 'X' }),
        select(variable('Mode')),
        select(variable('P')),
        select(variable('Removed')),
        select(variable('Timer'), { role: 'field', name: 'Q' }),
        { source: { tokens: [] } },
      ]),
      model,
    )
    expect(summary).toMatchObject({
      selectedLeaves: 7,
      resolvedLeaves: 2,
      unverifiedLeaves: 1,
      birthUpperBoundBytes: null,
    })
    expect(summary.issues.map((i) => [i.code, i.pointer, i.detail])).toEqual([
      ['config_type_unsupported', '/selections/2/source/tokens', 'type_enumeration'],
      ['project_selection_unresolved', '/selections/3/source/tokens', 'not_a_leaf'],
      ['project_selection_unresolved', '/selections/4/source/tokens', 'member_missing'],
    ])
  })

  it('computes the Sparkplug birth bound from declared types and names', () => {
    const summary = summarizeMqttSelections(
      integration(
        [select(variable('Counter')), { ...select(variable('P'), { role: 'field', name: 'X' }), metricName: 'px' }],
        'sparkplug_b',
      ),
      model,
    )
    expect(summary.issues).toEqual([])
    expect(summary.birthUpperBoundBytes).toBe(
      sparkplugBirthUpperBound([
        { destination: 'I0.Main.Counter', iecType: 'DINT', size: 4 },
        { destination: 'px', iecType: 'REAL', size: 4 },
      ]),
    )
  })

  it('flags a birth message over the limit before compiling', () => {
    const selections = Array.from({ length: 449 }, (_, i) => ({
      ...select(variable('Big'), { role: 'index', indices: [i] }),
      metricName: `${String(i).padStart(4, '0')}${'x'.repeat(508)}`,
    }))
    const summary = summarizeMqttSelections(integration(selections, 'sparkplug_b'), model)
    expect(summary.birthUpperBoundBytes).toBe(262310)
    expect(summary.issues.map((i) => [i.code, i.pointer])).toEqual([['config_payload_too_large', '/selections']])
    expect(summarizeMqttSelections(integration(selections.slice(0, 448), 'sparkplug_b'), model).issues).toEqual([])
  })

  it('leaves the bound open while a selection cannot be verified', () => {
    const noPrefix = summarizeMqttSelections(
      integration(
        [select(variable('Counter')), select(variable('Timer'), { role: 'field', name: 'Q' })],
        'sparkplug_b',
      ),
      model,
    )
    expect(noPrefix.birthUpperBoundBytes).toBeNull()
  })
})
