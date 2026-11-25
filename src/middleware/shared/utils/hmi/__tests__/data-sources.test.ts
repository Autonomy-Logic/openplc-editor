import type { HmiPlcVariable } from '../../../ports/hmi-preview-types'
import type { PLCDataType, PLCVariable } from '../../../ports/types'
import {
  hmiPlcSourceOf,
  hmiSourceForDrop,
  hmiSourceKind,
  hmiSourceLiteral,
  hmiSourceTakes,
  hmiWidgetAvailable,
} from '../data-sources'
import { hmiPlcVariables, hmiVariableTree } from '../plc-variables'

const array = (base: string, dimension: string, definition: 'base-type' | 'user-data-type' = 'user-data-type') => ({
  definition: 'array' as const,
  value: `ARRAY[${dimension}] OF ${base}`,
  data: { baseType: { definition, value: base }, dimensions: [{ dimension }] },
})

const v = (name: string, type: PLCVariable['type']): PLCVariable => ({ name, type, location: '', documentation: '' })

const project = {
  pous: [
    {
      name: 'Main',
      pouType: 'program' as const,
      body: { language: 'st' as const, value: '' },
      interface: {
        variables: [
          v('Alarms', array('HMI_ALARM_ROW', '1..50')),
          v('Events', array('HMI_EVENT_ROW', '0..199')),
          v('Sys', { definition: 'user-data-type', value: 'HMI_ALARM_SUMMARY' }),
          v('Flow', array('INT', '0..2', 'base-type')),
          v('Grid', array('INT', '0..2, 0..2', 'base-type')),
          v('Level', { definition: 'base-type', value: 'REAL' }),
        ],
      },
    },
  ],
  configurations: {
    resource: { tasks: [], instances: [{ name: 'instance0', task: 't', program: 'Main' }], globalVariables: [] },
  },
}

const CURVE: PLCDataType = {
  name: 'Curve',
  derivation: 'array',
  baseType: { definition: 'base-type', value: 'REAL' },
  dimensions: [{ dimension: '1..500' }],
}

describe('HMI data sources', () => {
  it('maps hmi_source values to kinds, ignoring case and spacing', () => {
    expect(hmiSourceKind('ARRAY OF HMI_ALARM_ROW')).toBe('alarms')
    expect(hmiSourceKind('array  of hmi_event_row')).toBe('events')
    expect(hmiSourceKind('HMI_ALARM_SUMMARY')).toBe('summary')
    expect(hmiSourceKind('ARRAY OF REAL')).toBe('numbers')
    expect(hmiSourceKind('ARRAY OF BOOL')).toBeNull()
  })

  it('reads the source a variable type gives, with its bounds', () => {
    expect(hmiPlcSourceOf(array('HMI_ALARM_ROW', '1..50'))).toEqual({ kind: 'alarms', lower: 1, upper: 50 })
    expect(hmiPlcSourceOf(array('DINT', '-2..2', 'base-type'))).toEqual({
      kind: 'numbers',
      lower: -2,
      upper: 2,
      element: 'DINT',
    })
    expect(hmiPlcSourceOf({ definition: 'user-data-type', value: 'hmi_alarm_summary' })).toEqual({ kind: 'summary' })
    expect(hmiPlcSourceOf(array('BOOL', '0..3', 'base-type'))).toBeNull()
    expect(hmiPlcSourceOf(array('INT', 'N..M', 'base-type'))).toBeNull()
    expect(hmiPlcSourceOf({ definition: 'user-data-type', value: 'Curve' }, [CURVE])).toEqual({
      kind: 'numbers',
      lower: 1,
      upper: 500,
      element: 'REAL',
    })
  })

  it('lists whole tables, logs, summaries and one-dimensional numeric arrays of any size as sources', () => {
    const sources = hmiPlcVariables(project).filter((v) => v.source)
    expect(sources).toEqual([
      {
        path: 'instance0.Main.Alarms',
        type: 'ARRAY[1..50] OF HMI_ALARM_ROW',
        source: { kind: 'alarms', lower: 1, upper: 50 },
      },
      {
        path: 'instance0.Main.Events',
        type: 'ARRAY[0..199] OF HMI_EVENT_ROW',
        source: { kind: 'events', lower: 0, upper: 199 },
      },
      { path: 'instance0.Main.Sys', type: 'HMI_ALARM_SUMMARY', source: { kind: 'summary' } },
      {
        path: 'instance0.Main.Flow',
        type: 'ARRAY[0..2] OF INT',
        source: { kind: 'numbers', lower: 0, upper: 2, element: 'INT' },
      },
    ])
    const tree = hmiVariableTree(hmiPlcVariables(project))
    const main = tree[0].children[0].children
    expect(main.find((n) => n.key === 'instance0.Main.Flow')?.source?.path).toBe('instance0.Main.Flow')
    expect(main.find((n) => n.key === 'instance0.Main.Alarms')?.variable?.source?.kind).toBe('alarms')
  })

  it('picks the source input a dropped variable sets: an empty one of its kind first', () => {
    const plot = {
      sources: [
        { name: 'XSource', type: 'ARRAY OF REAL', slot: 0 },
        { name: 'YSource', type: 'ARRAY OF REAL', slot: 1 },
      ],
    }
    const flow: HmiPlcVariable = { path: 'P.Flow', type: 'ARRAY[0..2] OF INT', source: { kind: 'numbers' } }
    expect(hmiSourceForDrop(plot, flow, () => '')).toBe('XSource')
    expect(hmiSourceForDrop(plot, flow, (n) => (n === 'XSource' ? 'P.A' : ''))).toBe('YSource')
    expect(hmiSourceForDrop(plot, flow, () => 'P.A')).toBe('XSource')
    const alarms: HmiPlcVariable = {
      path: 'P.Alarms',
      type: 'ARRAY[1..2] OF HMI_ALARM_ROW',
      source: { kind: 'alarms' },
    }
    expect(hmiSourceForDrop(plot, alarms, () => '')).toBeNull()
    expect(hmiSourceTakes('ARRAY OF HMI_ALARM_ROW', alarms)).toBe(true)
    expect(hmiSourceTakes('ARRAY OF HMI_ALARM_ROW', { path: 'X', type: 'BOOL' })).toBe(false)
    expect(hmiSourceLiteral('P.Alarms')).toBe("'P.Alarms'")
  })

  it('offers a widget only on a target that has the capability it requires', () => {
    expect(hmiWidgetAvailable({}, {})).toBe(true)
    expect(hmiWidgetAvailable({ requires: 'hmiDataWidgets' }, { hmiDataWidgets: true })).toBe(true)
    expect(hmiWidgetAvailable({ requires: 'hmiDataWidgets' }, { hmiDataWidgets: false })).toBe(false)
    expect(hmiWidgetAvailable({ requires: 'hmiDataWidgets' }, {})).toBe(false)
  })

  it('lists sources nested in structs, arrays of structs and block instances, down to the tree depth limit', () => {
    const line: PLCDataType = {
      name: 'Line',
      derivation: 'structure',
      variable: [
        { name: 'Alarms', type: array('HMI_ALARM_ROW', '1..20') },
        { name: 'Sys', type: { definition: 'user-data-type', value: 'HMI_ALARM_SUMMARY' } },
      ],
    }
    const deep = (n: number): PLCDataType => ({
      name: `D${n}`,
      derivation: 'structure',
      variable: [{ name: 'Next', type: { definition: 'user-data-type', value: n === 0 ? 'Line' : `D${n - 1}` } }],
    })
    const cell = {
      name: 'Cell',
      pouType: 'function-block' as const,
      body: { language: 'st' as const, value: '' },
      interface: {
        variables: [
          { ...v('Log', array('HMI_EVENT_ROW', '0..99')), class: 'input' as const },
          { ...v('Curve', array('REAL', '1..10', 'base-type')), class: 'output' as const },
          { ...v('Hidden', array('HMI_EVENT_ROW', '0..9')), class: 'local' as const },
        ],
      },
    }
    const main = {
      ...project.pous[0],
      interface: {
        variables: [
          v('L1', { definition: 'user-data-type', value: 'Line' }),
          v('Lines', array('Line', '1..2')),
          v('Unit', { definition: 'derived', value: 'Cell' }),
          v('Deep', { definition: 'user-data-type', value: 'D9' }),
        ],
      },
    }
    const sources = hmiPlcVariables(
      { ...project, pous: [main, cell], dataTypes: [line, ...Array.from({ length: 10 }, (_, n) => deep(n))] },
      new Map([['LIBFB', { inputs: [{ name: 'Summary', type: 'HMI_ALARM_SUMMARY' }], outputs: [] }]]),
    ).filter((x) => x.source)
    expect(sources.map((x) => [x.path, x.source?.kind, x.blockOutput ?? false])).toEqual([
      ['instance0.Main.L1.Alarms', 'alarms', false],
      ['instance0.Main.L1.Sys', 'summary', false],
      ['instance0.Main.Lines[1].Alarms', 'alarms', false],
      ['instance0.Main.Lines[1].Sys', 'summary', false],
      ['instance0.Main.Lines[2].Alarms', 'alarms', false],
      ['instance0.Main.Lines[2].Sys', 'summary', false],
      ['instance0.Main.Unit.Log', 'events', false],
      ['instance0.Main.Unit.Curve', 'numbers', true],
    ])
  })

  it('lists a source among the pins of a library block', () => {
    const main = {
      ...project.pous[0],
      interface: { variables: [v('Svc', { definition: 'derived', value: 'LibFb' })] },
    }
    const sources = hmiPlcVariables(
      { ...project, pous: [main] },
      new Map([['LIBFB', { inputs: [{ name: 'Summary', type: 'HMI_ALARM_SUMMARY' }], outputs: [] }]]),
    ).filter((x) => x.source)
    expect(sources).toEqual([
      { path: 'instance0.Main.Svc.Summary', type: 'HMI_ALARM_SUMMARY', source: { kind: 'summary' } },
    ])
  })
})
