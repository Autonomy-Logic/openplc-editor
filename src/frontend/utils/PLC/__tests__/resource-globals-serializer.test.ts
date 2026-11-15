import { analyze } from 'strucpp'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { serializeResourceGlobalsToST } from '../resource-globals-serializer'

function global(name: string, typeValue: string, extra: Partial<PLCVariable> = {}): PLCVariable {
  return { name, type: { definition: 'base-type', value: typeValue }, location: '', documentation: '', ...extra }
}

describe('serializeResourceGlobalsToST', () => {
  it('returns empty string when there are no globals', () => {
    expect(serializeResourceGlobalsToST([])).toBe('')
  })

  it('lists the program instances in the configuration the compiler emits, globals or not', () => {
    const resource = {
      tasks: [{ name: 'task0', triggering: 'Cyclic' as const, interval: 'T#20ms', priority: 1 }],
      instances: [
        { name: 'instance0', task: 'task0', program: 'Main' },
        { name: 'mixer1', task: '', program: 'Mixer' },
      ],
      programs: ['Main', 'Mixer'],
    }
    expect(serializeResourceGlobalsToST([], new Map(), resource)).toBe(
      [
        'CONFIGURATION Config0',
        '  RESOURCE Res0 ON PLC',
        '    TASK task0(INTERVAL := T#20ms, PRIORITY := 1);',
        '    PROGRAM instance0 WITH task0 : Main;',
        '    PROGRAM mixer1 : Mixer;',
        '  END_RESOURCE',
        'END_CONFIGURATION',
        '',
      ].join('\n'),
    )
    const st = serializeResourceGlobalsToST([global('g', 'INT')], new Map(), resource)
    expect(st.indexOf('VAR_GLOBAL')).toBeLessThan(st.indexOf('PROGRAM instance0'))
  })

  it('leaves out an instance row being filled in or left by a deleted program, so no document gets an error', () => {
    const main = 'PROGRAM Main\n  VAR x : INT; END_VAR\n  x := x + 1;\nEND_PROGRAM\n'
    const resource = {
      tasks: [
        { name: 'task0', triggering: 'Cyclic' as const, interval: 'T#20ms', priority: 1 },
        { name: '', triggering: 'Cyclic' as const, interval: '', priority: 0 },
      ],
      instances: [
        { name: 'instance0', task: 'task0', program: 'Main' },
        { name: 'instance1', task: 'task0', program: '' },
        { name: 'instance2', task: 'task0', program: 'Deleted' },
        { name: '', task: 'task0', program: 'Main' },
      ],
      programs: ['Main'],
    }
    const st = serializeResourceGlobalsToST([global('g', 'INT')], new Map(), resource)
    expect(st).toContain('PROGRAM instance0 WITH task0 : Main;')
    expect(st).not.toMatch(/instance1|instance2|TASK \(|PROGRAM  /)
    const result = analyze(main, { additionalSources: [{ fileName: 'resource.st', source: st }] })
    expect(result.errors).toEqual([])
  })

  it('wraps the globals in a CONFIGURATION so VAR_EXTERNAL resolves', () => {
    const st = serializeResourceGlobalsToST([global('test_global', 'DINT')])
    expect(st).toContain('CONFIGURATION')
    expect(st).toContain('VAR_GLOBAL')
    expect(st).toContain('test_global : DINT;')
    expect(st).toContain('END_VAR')
    expect(st).toContain('RESOURCE')
    expect(st).toContain('END_CONFIGURATION')
    // Globals must be at the CONFIGURATION level, before the RESOURCE block.
    expect(st.indexOf('VAR_GLOBAL')).toBeLessThan(st.indexOf('RESOURCE'))
  })

  it('emits a single VAR_GLOBAL block even if a stored global carries a stray class', () => {
    const st = serializeResourceGlobalsToST([global('a', 'INT', { class: 'external' }), global('b', 'BOOL')])
    // Both land in one VAR_GLOBAL block; no VAR_EXTERNAL leaks in.
    expect(st).not.toContain('VAR_EXTERNAL')
    expect((st.match(/VAR_GLOBAL/g) ?? []).length).toBe(1)
    expect(st).toContain('a : INT;')
    expect(st).toContain('b : BOOL;')
  })

  it('preserves location and initial value', () => {
    const st = serializeResourceGlobalsToST([global('counter', 'INT', { location: '%MW0', initialValue: '5' })])
    expect(st).toContain('counter : INT AT %MW0 := 5;')
  })

  // A global bound to a producer alias stores the alias NAME in `location`.
  // `AT <alias>` is not valid IEC ST and would take the whole VAR_GLOBAL block
  // — and every VAR_EXTERNAL that resolves against it — down with it.
  it('resolves an alias-bound location to its IEC address', () => {
    const st = serializeResourceGlobalsToST(
      [global('pressure', 'INT', { location: 'tank_alias' })],
      new Map([['tank_alias', '%IW4']]),
    )
    expect(st).toContain('pressure : INT AT %IW4;')
    expect(st).not.toContain('AT tank_alias')
  })

  it('drops an alias that no longer resolves instead of emitting invalid ST', () => {
    const st = serializeResourceGlobalsToST([global('pressure', 'INT', { location: 'gone' })], new Map())
    expect(st).toContain('pressure : INT;')
    expect(st).not.toContain('AT gone')
  })

  it('never emits a bare alias identifier when no index is supplied', () => {
    const st = serializeResourceGlobalsToST([global('pressure', 'INT', { location: 'tank_alias' })])
    expect(st).toContain('pressure : INT;')
    expect(st).not.toContain('AT tank_alias')
  })
})
