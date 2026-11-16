import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'
import { describe, expect, it } from '@jest/globals'

import { groupByScope } from '../components/group-exportable-variables'

function v(qualifier: string, type: string, scope: ExportableVariable['scope']): ExportableVariable {
  return {
    qualifier,
    scope,
    variable: qualifier.split('.').pop() ?? qualifier,
    type,
    isWritable: true,
  }
}

describe('groupByScope', () => {
  it('returns an empty array for an empty input', () => {
    expect(groupByScope([])).toEqual([])
  })

  it('groups program leaves under their program and GVL leaves under their list', () => {
    const result = groupByScope([
      v('Program0.pump_speed', 'INT', { kind: 'program', programName: 'Program0' }),
      v('GVL.setpoint', 'DINT', { kind: 'gvl', listName: 'GVL' }),
      v('Program0.temp_pv', 'INT', { kind: 'program', programName: 'Program0' }),
    ])

    expect(result.map((g) => g.key)).toEqual(['program:Program0', 'gvl:GVL'])
    expect(result[0].variables.map((x) => x.qualifier)).toEqual(['Program0.pump_speed', 'Program0.temp_pv'])
    expect(result[1].variables.map((x) => x.qualifier)).toEqual(['GVL.setpoint'])
  })

  it('places programs alphabetically before GVLs', () => {
    const result = groupByScope([
      v('Zeta.a', 'INT', { kind: 'program', programName: 'Zeta' }),
      v('GVL.b', 'INT', { kind: 'gvl', listName: 'GVL' }),
      v('Alpha.c', 'INT', { kind: 'program', programName: 'Alpha' }),
    ])

    expect(result.map((g) => g.label)).toEqual(['Alpha', 'Zeta', 'GVL'])
  })

  it('does not collide a program and a GVL that share the same label', () => {
    const result = groupByScope([
      v('GVL.a', 'INT', { kind: 'program', programName: 'GVL' }),
      v('GVL.b', 'INT', { kind: 'gvl', listName: 'GVL' }),
    ])

    expect(result.map((g) => g.key)).toEqual(['program:GVL', 'gvl:GVL'])
    expect(result[0].variables.map((x) => x.qualifier)).toEqual(['GVL.a'])
    expect(result[1].variables.map((x) => x.qualifier)).toEqual(['GVL.b'])
  })
})
